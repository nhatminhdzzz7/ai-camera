/* =========================================================
   AI CAMERA — hand-gesture.js
   Nhận diện cử chỉ tay bằng MediaPipe Tasks Vision (GestureRecognizer)
   Chạy độc lập với script.js — chỉ tự đọc chung <video id="video">
   ⚠️ Cần Internet: model + wasm được tải từ CDN của Google/jsDelivr,
      KHÔNG đi kèm sẵn trong thư mục models/ như face-api.js.
   ========================================================= */
import {
    GestureRecognizer,
    FilesetResolver,
    DrawingUtils
} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/vision_bundle.mjs';

/* ----- Cấu hình ----- */
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';
const NUM_HANDS = 2;
const DETECTION_INTERVAL = 250;     // ms giữa mỗi lần quét cử chỉ tay
const GESTURE_CONFIDENCE = 0.6;     // Ngưỡng tin cậy tối thiểu để hiển thị
const LOVE_YOU_DISPLAY_MS = 1500;   // Chữ "I love you" tiếp tục hiện thêm chừng này sau khi mất cử chỉ

/* ----- Ánh xạ cử chỉ sang tiếng Việt -----
   7 cử chỉ dựng sẵn của MediaPipe GestureRecognizer.
   Lưu ý: "ILoveYou" là ký hiệu 🤟 (ngón cái + trỏ + út xoè ra, kiểu Mỹ),
   khác với hình trái tim 2 ngón tay kiểu Hàn — model chưa hỗ trợ hình đó. */
const GESTURE_MAP = {
    Closed_Fist:  { label: 'Nắm đấm',     emoji: '✊' },
    Open_Palm:    { label: 'Bàn tay mở',  emoji: '🖐️' },
    Pointing_Up:  { label: 'Chỉ lên',     emoji: '☝️' },
    Thumb_Down:   { label: 'Không thích', emoji: '👎' },
    Thumb_Up:     { label: 'Thích',       emoji: '👍' },
    Victory:      { label: 'Chữ V',       emoji: '✌️' },
    ILoveYou:     { label: 'Yêu thương',  emoji: '🤟' },
    None:         { label: '—',           emoji: '' }
};

/* ----- Biến toàn cục ----- */
let video, handCanvas, handCtx, drawingUtils;
let gestureRecognizer = null;
let loadFailed = false;
let lastVideoTime = -1;
let loveYouHideTimer = null;
let tickTimer = null;

/* =========================================================
   1. KHỞI TẠO
   ========================================================= */
document.addEventListener('DOMContentLoaded', async () => {
    video = document.getElementById('video');
    handCanvas = document.getElementById('handCanvas');
    handCtx = handCanvas.getContext('2d');
    drawingUtils = new DrawingUtils(handCtx);

    await loadGestureRecognizer();

    // Vòng lặp tự kiểm tra: camera đang bật thì detect, tắt thì dọn canvas.
    // Không phụ thuộc vào script.js — chỉ đọc trạng thái video dùng chung.
    tickTimer = setInterval(tick, DETECTION_INTERVAL);
});

async function loadGestureRecognizer() {
    const statusEl = document.getElementById('gestureStatus');
    try {
        const vision = await FilesetResolver.forVisionTasks(WASM_URL);
        gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
            baseOptions: { modelAssetPath: MODEL_URL },
            runningMode: 'VIDEO',
            numHands: NUM_HANDS
        });
        if (statusEl) statusEl.textContent = '—';
        console.log('✅ MediaPipe GestureRecognizer đã tải xong!');
    } catch (err) {
        console.error('❌ Lỗi tải model nhận diện cử chỉ tay:', err);
        loadFailed = true;
        if (statusEl) {
            statusEl.textContent = 'Không tải được (cần Internet)';
            statusEl.style.color = 'var(--accent-red)';
        }
    }
}

/* =========================================================
   2. VÒNG LẶP CHÍNH
   ========================================================= */
function tick() {
    if (loadFailed || !gestureRecognizer) return;

    const cameraActive = video && video.srcObject && video.readyState >= 2;
    if (!cameraActive) {
        clearHandCanvas();
        return;
    }

    // Đồng bộ kích thước canvas với video
    if (handCanvas.width !== video.videoWidth || handCanvas.height !== video.videoHeight) {
        handCanvas.width = video.videoWidth;
        handCanvas.height = video.videoHeight;
    }

    // Tránh xử lý lại đúng một khung hình (video chưa tua tiếp)
    if (video.currentTime === lastVideoTime) return;
    lastVideoTime = video.currentTime;

    const timestampMs = performance.now();
    let results;
    try {
        results = gestureRecognizer.recognizeForVideo(video, timestampMs);
    } catch (err) {
        // Bỏ qua lỗi tạm thời (ví dụ frame chưa sẵn sàng)
        return;
    }

    clearHandCanvas();
    drawHands(results);
    updateGestureStatus(results);
}

/* =========================================================
   3. VẼ KHUNG XƯƠNG BÀN TAY
   ========================================================= */
function drawHands(results) {
    if (!results.landmarks || results.landmarks.length === 0) return;

    results.landmarks.forEach(landmarks => {
        drawingUtils.drawConnectors(landmarks, GestureRecognizer.HAND_CONNECTIONS, {
            color: 'rgba(232, 67, 147, 0.85)',
            lineWidth: 3
        });
        drawingUtils.drawLandmarks(landmarks, {
            color: 'rgba(0, 210, 255, 0.9)',
            lineWidth: 1,
            radius: 3
        });
    });
}

function clearHandCanvas() {
    if (handCanvas.width && handCanvas.height) {
        handCtx.clearRect(0, 0, handCanvas.width, handCanvas.height);
    }
}

/* =========================================================
   4. CẬP NHẬT KẾT QUẢ CỬ CHỈ + HIỆU ỨNG "I LOVE YOU"
   ========================================================= */
function updateGestureStatus(results) {
    const statusEl = document.getElementById('gestureStatus');
    if (!results.gestures || results.gestures.length === 0) {
        if (statusEl) statusEl.textContent = '—';
        return;
    }

    let sawLoveYou = false;
    const parts = [];

    results.gestures.forEach(handGestures => {
        if (!handGestures || handGestures.length === 0) return;
        const top = handGestures[0]; // kết quả tin cậy cao nhất
        if (top.score < GESTURE_CONFIDENCE) return;

        const info = GESTURE_MAP[top.categoryName] || GESTURE_MAP.None;
        if (info.label !== '—') {
            parts.push(`${info.emoji} ${info.label}`);
        }
        if (top.categoryName === 'ILoveYou') sawLoveYou = true;
    });

    if (statusEl) statusEl.textContent = parts.length ? parts.join('   ·   ') : '—';

    if (sawLoveYou) showLoveYouOverlay();
}

function showLoveYouOverlay() {
    const overlay = document.getElementById('loveYouOverlay');
    if (!overlay) return;
    overlay.classList.add('show');
    clearTimeout(loveYouHideTimer);
    loveYouHideTimer = setTimeout(() => {
        overlay.classList.remove('show');
    }, LOVE_YOU_DISPLAY_MS);
}
