/* =========================================================
   AI CAMERA — script.js
   Nhận diện khuôn mặt với face-api.js
   Chạy 100% client-side, không cần backend
   ========================================================= */

/* ----- Cấu hình ----- */
const MODEL_URL = 'models';          // Thư mục chứa model face-api.js
const DETECTION_INTERVAL = 300;      // ms giữa mỗi lần quét khuôn mặt (realtime)
const MIN_CONFIDENCE = 0.5;          // Ngưỡng tin cậy tối thiểu
const EAR_THRESHOLD = 0.23;          // Eye Aspect Ratio dưới ngưỡng này = đang nhắm mắt
const MAX_PEOPLE = 4;                // Quá số này thì cảnh báo "quá nhiều người"
const LOOK_YAW_LIMIT = 15;           // Độ lệch yaw tối đa để tính là "đang nhìn camera"
const LOOK_ROLL_LIMIT = 12;          // Độ lệch roll tối đa để tính là "đang nhìn camera"

/* ----- Biến toàn cục ----- */
let video, canvas, ctx;
let stream = null;
let modelsLoaded = false;
let detectionLoop = null;
let currentFacingMode = 'user';      // 'user' (trước) hoặc 'environment' (sau)
let lastCapturedBlob = null;         // Ảnh vừa chụp (dạng Blob để tải xuống)
let isDetecting = false;             // Tránh chạy chồng detection loop
let currentFilter = 'none';          // Filter mặt nạ đang chọn: none | glasses | dog | cat | crown
let requireSmileToCapture = false;   // Chỉ cho phép chụp khi phát hiện đang cười
let lastFaceData = null;             // { isSmiling, eyesClosed, isLooking, faceCount } — cập nhật mỗi lần detect

/* ----- Ánh xạ cảm xúc sang tiếng Việt ----- */
const EMOTION_MAP = {
    neutral:   { label: 'Trung tính',  emoji: '😐', class: 'neutral'   },
    happy:     { label: 'Vui vẻ',      emoji: '😄', class: 'happy'     },
    sad:       { label: 'Buồn bã',     emoji: '😢', class: 'sad'       },
    angry:     { label: 'Tức giận',    emoji: '😠', class: 'angry'     },
    fearful:   { label: 'Sợ hãi',      emoji: '😨', class: 'fearful'   },
    disgusted: { label: 'Ghê tởm',     emoji: '🤢', class: 'disgusted' },
    surprised: { label: 'Ngạc nhiên',  emoji: '😲', class: 'surprised' }
};

/* =========================================================
   1. KHỞI TẠO — chạy khi DOM sẵn sàng
   ========================================================= */
document.addEventListener('DOMContentLoaded', async () => {
    // Lấy element
    video   = document.getElementById('video');
    canvas  = document.getElementById('overlayCanvas');
    ctx     = canvas.getContext('2d');

    // Gán sự kiện cho các nút
    document.getElementById('startBtn').addEventListener('click', toggleCamera);
    document.getElementById('captureBtn').addEventListener('click', capturePhoto);
    document.getElementById('switchBtn').addEventListener('click', switchCamera);
    document.getElementById('downloadBtn').addEventListener('click', downloadPhoto);

    // Gán sự kiện cho toggle "chỉ chụp khi cười"
    document.getElementById('requireSmileToggle').addEventListener('change', (e) => {
        requireSmileToCapture = e.target.checked;
    });

    // Gán sự kiện cho các nút filter
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.filter;
        });
    });

    // Tải model face-api.js
    await loadModels();
});

/* =========================================================
   2. TẢI MODEL FACE-API.JS
   ========================================================= */
async function loadModels() {
    const loadingScreen = document.getElementById('loadingScreen');

    try {
        /*
         * Chúng ta cần 3 mạng nơ-ron:
         *  - tinyFaceDetector: phát hiện khuôn mặt (nhanh, nhẹ)
         *  - faceExpressionNet: nhận diện cảm xúc
         *  - faceLandmark68Net: vẽ 68 điểm landmark trên khuôn mặt
         */
        await Promise.all([
            faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
            faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL),
            faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL)
        ]);

        modelsLoaded = true;
        console.log('✅ Model face-api.js đã tải xong!');
        loadingScreen.classList.add('hidden');

    } catch (err) {
        console.error('❌ Lỗi tải model:', err);
        loadingScreen.innerHTML = `
            <div style="text-align:center; max-width: 420px; padding: 20px;">
                <p style="color: var(--accent-red); font-size: 1.1rem; font-weight: 700; margin-bottom: 12px;">
                    ⚠️ Không tải được model AI
                </p>
                <p style="font-size: 0.85rem; line-height: 1.6;">
                    Vui lòng tải các file model từ face-api.js vào thư mục <code style="color: var(--accent-cyan);">models/</code>.
                    Xem hướng dẫn trong README hoặc console (F12).
                </p>
            </div>
        `;
    }
}

/* =========================================================
   3. BẬT / TẮT CAMERA
   ========================================================= */
async function toggleCamera() {
    if (stream) {
        // Đang bật → tắt
        stopCamera();
    } else {
        // Đang tắt → bật
        await startCamera();
    }
}

async function startCamera() {
    if (!modelsLoaded) {
        alert('Model AI chưa sẵn sàng. Vui lòng đợi hoặc tải lại trang.');
        return;
    }

    try {
        // Cấu hình ràng buộc camera
        const constraints = {
            video: {
                facingMode: currentFacingMode,
                width:  { ideal: 1280 },
                height: { ideal: 720 }
            },
            audio: false
        };

        stream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = stream;

        // Đợi video sẵn sàng
        video.onloadedmetadata = () => {
            // Đồng bộ kích thước canvas với video
            resizeCanvas();
            updateStatus('Camera đang hoạt động', true);
            startDetectionLoop();
        };

        // Cập nhật UI
        updateButtonStates(true);

    } catch (err) {
        console.error('Lỗi truy cập camera:', err);
        let msg = 'Không thể truy cập camera.';
        if (err.name === 'NotAllowedError') {
            msg = 'Bạn đã từ chối quyền truy cập camera. Vui lòng cho phép trong cài đặt trình duyệt.';
        } else if (err.name === 'NotFoundError') {
            msg = 'Không tìm thấy camera trên thiết bị này.';
        }
        alert(msg);
    }
}

function stopCamera() {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }
    video.srcObject = null;
    if (detectionLoop) {
        clearInterval(detectionLoop);
        detectionLoop = null;
    }
    clearCanvas();
    updateStatus('Camera đã tắt', false);
    updateButtonStates(false);
    resetResults();
}

/* =========================================================
   4. ĐỔI CAMERA TRƯỚC / SAU (cho điện thoại)
   ========================================================= */
async function switchCamera() {
    if (!stream) return;

    // Đổi chế độ
    currentFacingMode = (currentFacingMode === 'user') ? 'environment' : 'user';

    // Dừng stream hiện tại rồi bật lại với facingMode mới
    stream.getTracks().forEach(track => track.stop());
    stream = null;
    clearCanvas();

    try {
        const constraints = {
            video: { facingMode: currentFacingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false
        };
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = stream;

        video.onloadedmetadata = () => {
            resizeCanvas();
        };

    } catch (err) {
        console.error('Lỗi đổi camera:', err);
        // Nếu không đổi được, quay lại camera trước
        currentFacingMode = 'user';
        alert('Không thể đổi camera. Thiết bị có thể không hỗ trợ.');
    }
}

/* =========================================================
   5. VÒNG LẶP PHÁT HIỆN KHUÔN MẶT (realtime)
   ========================================================= */
function startDetectionLoop() {
    if (detectionLoop) clearInterval(detectionLoop);

    detectionLoop = setInterval(async () => {
        if (isDetecting || !stream || video.readyState < 2) return;
        isDetecting = true;

        try {
            await detectFaces();
        } catch (e) {
            // Bỏ qua lỗi tạm thời
        } finally {
            isDetecting = false;
        }
    }, DETECTION_INTERVAL);
}

/* =========================================================
   6. PHÁT HIỆN & PHÂN TÍCH KHUÔN MẶT
   ========================================================= */
async function detectFaces() {
    const options = new faceapi.TinyFaceDetectorOptions({
        inputSize: 320,
        scoreThreshold: MIN_CONFIDENCE
    });

    /*
     * detectAllFaces → phát hiện tất cả khuôn mặt
     * withFaceLandmarks → vẽ 68 điểm landmark
     * withFaceExpressions → nhận diện 7 cảm xúc
     */
    const detections = await faceapi
        .detectAllFaces(video, options)
        .withFaceLandmarks()
        .withFaceExpressions();

    // Xóa canvas cũ
    clearCanvas();

    if (detections.length === 0) {
        // Không có khuôn mặt
        showNoFaceAlert(true);
        showTooManyAlert(false);
        resetResults();
        lastFaceData = null;
    } else {
        // Có khuôn mặt
        showNoFaceAlert(false);
        showTooManyAlert(detections.length > MAX_PEOPLE);

        // Vẽ bounding box + landmarks lên canvas
        drawDetections(detections);

        // Cập nhật kết quả (lấy khuôn mặt đầu tiên để hiển thị chi tiết)
        updateResults(detections);
    }
}

/* =========================================================
   7. VẼ BOUNDING BOX + LANDMARKS LÊN CANVAS
   ========================================================= */
function drawDetections(detections) {
    const videoWidth  = video.videoWidth;
    const videoHeight = video.videoHeight;

    // Đồng bộ canvas với kích thước thực của video
    if (canvas.width !== videoWidth || canvas.height !== videoHeight) {
        canvas.width  = videoWidth;
        canvas.height = videoHeight;
    }

    detections.forEach((det, index) => {
        const box = det.detection.box;
        const expressions = det.expressions;
        const landmarks = det.landmarks;

        // --- Vẽ bounding box ---
        drawBoundingBox(box, index, expressions);

        // --- Vẽ 68 điểm landmark ---
        drawLandmarks(landmarks);

        // --- Vẽ filter mặt nạ (nếu có chọn) ---
        if (currentFilter !== 'none') {
            drawFilter(landmarks, box, currentFilter);
        }
    });
}

function drawBoundingBox(box, index, expressions) {
    const { x, y, width, height } = box;

    // Màu viền dựa trên cảm xúc mạnh nhất
    const topEmotion = getTopEmotion(expressions);
    const color = getEmotionColor(topEmotion.key);

    // Bo góc cho bounding box (chỉ vẽ 4 góc thay vì cả hình chữ nhật)
    const cornerLen = Math.min(width, height) * 0.2;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';

    // Góc trên trái
    ctx.beginPath();
    ctx.moveTo(x, y + cornerLen);
    ctx.lineTo(x, y);
    ctx.lineTo(x + cornerLen, y);
    ctx.stroke();

    // Góc trên phải
    ctx.beginPath();
    ctx.moveTo(x + width - cornerLen, y);
    ctx.lineTo(x + width, y);
    ctx.lineTo(x + width, y + cornerLen);
    ctx.stroke();

    // Góc dưới trái
    ctx.beginPath();
    ctx.moveTo(x, y + height - cornerLen);
    ctx.lineTo(x, y + height);
    ctx.lineTo(x + cornerLen, y + height);
    ctx.stroke();

    // Góc dưới phải
    ctx.beginPath();
    ctx.moveTo(x + width - cornerLen, y + height);
    ctx.lineTo(x + width, y + height);
    ctx.lineTo(x + width, y + height - cornerLen);
    ctx.stroke();

    // Nhãn cảm xúc phía trên box
    const label = `#${index + 1} ${EMOTION_MAP[topEmotion.key].emoji} ${(topEmotion.prob * 100).toFixed(0)}%`;

    ctx.font = 'bold 14px Inter, sans-serif';
    const textWidth = ctx.measureText(label).width;

    // Nền nhãn
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(x, y - 24, textWidth + 16, 22);

    // Chữ nhãn
    ctx.fillStyle = color;
    ctx.fillText(label, x + 8, y - 8);
}

function drawLandmarks(landmarks) {
    const positions = landmarks.positions;

    // Vẽ từng điểm landmark
    positions.forEach(point => {
        // Vòng tròn ngoài (halo)
        ctx.beginPath();
        ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 210, 255, 0.25)';
        ctx.fill();

        // Điểm chính
        ctx.beginPath();
        ctx.arc(point.x, point.y, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 210, 255, 0.9)';
        ctx.fill();
    });

    // Nối các điểm để tạo hình miệng (cho dễ nhìn)
    const mouthPoints = landmarks.getMouth();
    if (mouthPoints.length > 0) {
        ctx.beginPath();
        ctx.moveTo(mouthPoints[0].x, mouthPoints[0].y);
        for (let i = 1; i < mouthPoints.length; i++) {
            ctx.lineTo(mouthPoints[i].x, mouthPoints[i].y);
        }
        ctx.closePath();
        ctx.strokeStyle = 'rgba(0, 210, 255, 0.4)';
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    // Nối lông mày
    const leftBrow = landmarks.getLeftEyeBrow();
    const rightBrow = landmarks.getRightEyeBrow();
    drawLineThroughPoints(leftBrow);
    drawLineThroughPoints(rightBrow);
}

function drawLineThroughPoints(points) {
    if (points.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.strokeStyle = 'rgba(0, 210, 255, 0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
}

/* =========================================================
   7b. FILTER MẶT NẠ (kính, tai thú, vương miện)
   ========================================================= */
function avgPoint(points) {
    const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
    return { x: sum.x / points.length, y: sum.y / points.length };
}

function drawFilter(landmarks, box, filter) {
    const leftEye  = landmarks.getLeftEye();
    const rightEye = landmarks.getRightEye();
    const nose     = landmarks.getNose();
    const leftBrow  = landmarks.getLeftEyeBrow();
    const rightBrow = landmarks.getRightEyeBrow();

    const leftEyeCenter  = avgPoint(leftEye);
    const rightEyeCenter = avgPoint(rightEye);
    const eyeDist = Math.hypot(rightEyeCenter.x - leftEyeCenter.x, rightEyeCenter.y - leftEyeCenter.y);

    // Ước lượng đỉnh đầu (phía trên lông mày, vì landmark không có trán/tóc)
    const browTopY = Math.min(...leftBrow.map(p => p.y), ...rightBrow.map(p => p.y));
    const headTopY = browTopY - box.height * 0.35;
    const headCenterX = box.x + box.width / 2;

    switch (filter) {
        case 'glasses':
            drawGlasses(leftEyeCenter, rightEyeCenter, eyeDist);
            break;
        case 'dog':
            drawEars('#8d5a3b', '#c98d5e', headCenterX, headTopY, box.width);
            drawNoseDot('#1a1a1a', nose);
            break;
        case 'cat':
            drawEars('#4a4a52', '#e8a0b8', headCenterX, headTopY, box.width, true);
            drawWhiskers(nose, eyeDist);
            break;
        case 'crown':
            drawCrown(headCenterX, headTopY, box.width);
            break;
    }
}

// --- Kính râm ---
function drawGlasses(leftEyeCenter, rightEyeCenter, eyeDist) {
    const lensR = eyeDist * 0.42;
    ctx.save();
    ctx.fillStyle = 'rgba(15, 15, 20, 0.88)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 2;

    [leftEyeCenter, rightEyeCenter].forEach(c => {
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, lensR, lensR * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    });

    // Cầu kính nối giữa hai mắt
    ctx.beginPath();
    ctx.moveTo(leftEyeCenter.x + lensR, leftEyeCenter.y);
    ctx.lineTo(rightEyeCenter.x - lensR, rightEyeCenter.y);
    ctx.stroke();
    ctx.restore();
}

// --- Tai chó / mèo (hình tam giác) ---
function drawEars(outerColor, innerColor, cx, topY, faceWidth, pointed) {
    const earW = faceWidth * 0.28;
    const earH = faceWidth * 0.38;
    const gap = faceWidth * 0.32;

    [-1, 1].forEach(side => {
        const baseX = cx + side * gap;
        ctx.save();
        ctx.fillStyle = outerColor;
        ctx.beginPath();
        ctx.moveTo(baseX - earW / 2, topY);
        ctx.lineTo(baseX + earW / 2, topY);
        ctx.lineTo(baseX + side * earW * 0.1, topY - earH);
        ctx.closePath();
        ctx.fill();

        // Phần trong tai
        ctx.fillStyle = innerColor;
        ctx.beginPath();
        ctx.moveTo(baseX - earW * 0.28, topY - earH * 0.12);
        ctx.lineTo(baseX + earW * 0.28, topY - earH * 0.12);
        ctx.lineTo(baseX + side * earW * 0.08, topY - earH * 0.72);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    });
}

// --- Chấm mũi (chó) ---
function drawNoseDot(color, nose) {
    const tip = nose[Math.floor(nose.length / 2)];
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(tip.x, tip.y + 4, 9, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

// --- Ria mèo ---
function drawWhiskers(nose, eyeDist) {
    const tip = nose[Math.floor(nose.length / 2)];
    const len = eyeDist * 0.65;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 1.5;
    [-1, 1].forEach(side => {
        [-10, 0, 10].forEach(angleOffset => {
            ctx.beginPath();
            ctx.moveTo(tip.x + side * 6, tip.y + angleOffset * 0.3);
            ctx.lineTo(tip.x + side * (6 + len), tip.y + angleOffset);
            ctx.stroke();
        });
    });
    ctx.restore();
}

// --- Vương miện (emoji) ---
function drawCrown(cx, topY, faceWidth) {
    const size = faceWidth * 0.55;
    ctx.save();
    ctx.font = `${size}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('👑', cx, topY + size * 0.35);
    ctx.restore();
}

/* =========================================================
   8. CẬP NHẬT KẾT QUẢ PHÂN TÍCH
   ========================================================= */
function updateResults(detections) {
    const firstFace = detections[0];
    const expressions = firstFace.expressions;
    const landmarks = firstFace.landmarks;

    // --- Số lượng khuôn mặt ---
    document.getElementById('faceCount').textContent = detections.length;

    // --- Phát hiện cười ---
    // happy threshold > 0.5 được xem là đang cười
    const isSmiling = expressions.happy > 0.5;
    const smileEl = document.getElementById('smileStatus');
    if (isSmiling) {
        smileEl.textContent = 'Có 😊';
        smileEl.style.color = 'var(--accent-green)';
    } else {
        smileEl.textContent = 'Không 😐';
        smileEl.style.color = 'var(--text-secondary)';
    }

    // --- Góc quay đầu ---
    // Ước lượng dựa trên vị trí mũi so với trung tâm khuôn mặt
    const headAngle = estimateHeadAngle(landmarks, firstFace.detection.box);
    const angleEl = document.getElementById('headAngle');
    angleEl.textContent = headAngle.label;
    angleEl.style.color = headAngle.color;

    // --- Trạng thái mắt (nhắm / mở) ---
    const leftEAR  = getEAR(landmarks.getLeftEye());
    const rightEAR = getEAR(landmarks.getRightEye());
    const avgEAR   = (leftEAR + rightEAR) / 2;
    const eyesClosed = avgEAR < EAR_THRESHOLD;

    const eyeEl = document.getElementById('eyeStatus');
    if (eyesClosed) {
        eyeEl.textContent = 'Nhắm 😴';
        eyeEl.style.color = 'var(--accent-orange)';
    } else {
        eyeEl.textContent = 'Mở 👁️';
        eyeEl.style.color = 'var(--accent-green)';
    }
    showEyesClosedAlert(eyesClosed);

    // --- Có đang nhìn vào camera không ---
    const isLooking = Math.abs(headAngle.yaw) <= LOOK_YAW_LIMIT && Math.abs(headAngle.roll) <= LOOK_ROLL_LIMIT;
    const lookEl = document.getElementById('lookingStatus');
    if (isLooking) {
        lookEl.textContent = 'Có 👀';
        lookEl.style.color = 'var(--accent-green)';
    } else {
        lookEl.textContent = 'Không';
        lookEl.style.color = 'var(--text-secondary)';
    }

    // --- Lưu lại kết quả mới nhất để capturePhoto() dùng ---
    lastFaceData = { isSmiling, eyesClosed, isLooking, faceCount: detections.length };

    // Nếu chế độ "chỉ chụp khi cười" đang bật, ẩn cảnh báo khi người dùng đã cười
    if (requireSmileToCapture && isSmiling) showSmileRequiredAlert(false);

    // --- Cảm xúc chi tiết ---
    updateEmotionList(expressions);
}

function updateEmotionList(expressions) {
    const emotionList = document.getElementById('emotionList');
    emotionList.innerHTML = '';

    // Sắp xếp cảm xúc theo xác suất giảm dần
    const sorted = Object.entries(expressions)
        .map(([key, prob]) => ({ key, prob }))
        .sort((a, b) => b.prob - a.prob);

    sorted.forEach(({ key, prob }) => {
        const info = EMOTION_MAP[key];
        if (!info) return;

        const percent = (prob * 100).toFixed(1);
        const item = document.createElement('div');
        item.className = `emotion-item emotion-${info.class}`;
        item.innerHTML = `
            <div class="emotion-item-header">
                <span class="emotion-item-name">${info.emoji} ${info.label}</span>
                <span class="emotion-item-percent">${percent}%</span>
            </div>
            <div class="emotion-bar">
                <div class="emotion-bar-fill" style="width: ${percent}%"></div>
            </div>
        `;
        emotionList.appendChild(item);
    });
}

/* =========================================================
   9. ƯỚC LƯỢNG GÓC QUAY ĐẦU
   ========================================================= */
function estimateHeadAngle(landmarks, box) {
    /*
     * face-api.js không trực tiếp xuất góc yaw/pitch/roll,
     * nhưng chúng ta có thể ước lượng dựa trên vị trí tương đối
     * của mũi (landmark 30) so với trung tâm bounding box.
     *
     * - noseX lệch trái / phải → quay đầu ngang (yaw)
     * - noseY lệch lên / xuống → gật / ngẩng đầu (pitch)
     * - We also use eye angle for roll (nghiêng đầu sang bên)
     */
    const noseTip = landmarks.getNose()[3]; // điểm đầu mũi
    const leftEye = landmarks.getLeftEye();
    const rightEye = landmarks.getRightEye();

    const boxCx = box.x + box.width / 2;
    const boxCy = box.y + box.height / 2;

    // Yaw (quay trái / phải) — dựa trên lệch ngang của mũi
    const offsetX = (noseTip.x - boxCx) / (box.width / 2); // -1 ~ 1
    const yawDeg = (offsetX * 35).toFixed(0); // tối đa ~35°

    // Roll (nghiêng đầu sang vai) — dựa trên góc giữa hai mắt
    const eyeMidLeft  = leftEye[0];
    const eyeMidRight = rightEye[rightEye.length - 1];
    const eyeDx = eyeMidRight.x - eyeMidLeft.x;
    const eyeDy = eyeMidRight.y - eyeMidLeft.y;
    const rollDeg = Math.atan2(eyeDy, eyeDx) * 180 / Math.PI;

    // Tổng hợp nhãn
    let yawLabel = '';
    if (Math.abs(yawDeg) < 8)      yawLabel = 'thẳng';
    else if (yawDeg > 0)           yawLabel = `sang phải ${Math.abs(yawDeg)}°`;
    else                           yawLabel = `sang trái ${Math.abs(yawDeg)}°`;

    let rollLabel = '';
    if (Math.abs(rollDeg) < 5)     rollLabel = '';
    else if (rollDeg > 0)          rollLabel = `, nghiêng phải ${Math.abs(rollDeg).toFixed(0)}°`;
    else                           rollLabel = `, nghiêng trái ${Math.abs(rollDeg).toFixed(0)}°`;

    const fullLabel = `${yawLabel}${rollLabel}`;

    // Màu sắc
    let color = 'var(--accent-green)';
    if (Math.abs(yawDeg) > 20 || Math.abs(rollDeg) > 15) {
        color = 'var(--accent-orange)';
    }

    return { label: fullLabel, color, yaw: Number(yawDeg), roll: rollDeg };
}

/* =========================================================
   9b. TÍNH EYE ASPECT RATIO (EAR) — phát hiện nhắm mắt
   ========================================================= */
function getEAR(eyePoints) {
    // eyePoints: 6 điểm landmark quanh mắt (thứ tự chuẩn 68-point)
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const vertical1 = dist(eyePoints[1], eyePoints[5]);
    const vertical2 = dist(eyePoints[2], eyePoints[4]);
    const horizontal = dist(eyePoints[0], eyePoints[3]);
    if (horizontal === 0) return 0.3;
    return (vertical1 + vertical2) / (2 * horizontal);
}

/* =========================================================
   10. CHỤP ẢNH
   ========================================================= */
function capturePhoto() {
    if (!stream) return;

    // Nếu bật "chỉ chụp khi cười" mà chưa cười (hoặc không có khuôn mặt) → chặn chụp
    if (requireSmileToCapture && (!lastFaceData || !lastFaceData.isSmiling)) {
        showSmileRequiredAlert(true);
        setTimeout(() => showSmileRequiredAlert(false), 2000);
        return;
    }

    // Hiệu ứng flash
    const flash = document.getElementById('captureFlash');
    flash.classList.add('active');
    setTimeout(() => flash.classList.remove('active'), 400);

    // Tạo canvas tạm để chụp ảnh (kết hợp video + overlay)
    const captureCanvas = document.createElement('canvas');
    captureCanvas.width  = video.videoWidth;
    captureCanvas.height = video.videoHeight;
    const captureCtx = captureCanvas.getContext('2d');

    // Lật ngược ảnh horizontally (do video đang mirror)
    captureCtx.translate(captureCanvas.width, 0);
    captureCtx.scale(-1, 1);

    // Vẽ khung hình video
    captureCtx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);

    // Vẽ overlay (bounding box + landmarks) — nhưng cần lật ngược lại
    captureCtx.setTransform(1, 0, 0, 1, 0, 0); // reset transform
    captureCtx.translate(captureCanvas.width, 0);
    captureCtx.scale(-1, 1);
    captureCtx.drawImage(canvas, 0, 0, captureCanvas.width, captureCanvas.height);

    // Chuyển thành data URL
    const dataURL = captureCanvas.toDataURL('image/png');
    lastCapturedBlob = dataURL;
    uploadToCloudinary(dataURL);

    // Hiển thị preview
    const previewImg = document.getElementById('capturedImage');
    previewImg.src = dataURL;
    previewImg.style.display = 'block';
    document.getElementById('previewEmpty').style.display = 'none';

    // Bật nút tải xuống
    document.getElementById('downloadBtn').disabled = false;
}

/* =========================================================
   11. TẢI ẢNH XUỐNG
   ========================================================= */
function downloadPhoto() {
    if (!lastCapturedBlob) return;

    const link = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    link.download = `ai-camera-${timestamp}.png`;
    link.href = lastCapturedBlob;
    link.click();
}

/* =========================================================
   12. HÀM TIỆN ÍCH (utilities)
   ========================================================= */

/* Resize canvas theo video */
function resizeCanvas() {
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
}

/* Xóa canvas */
function clearCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

/* Cập nhật trạng thái */
function updateStatus(text, active) {
    document.getElementById('statusText').textContent = text;
    const dot = document.getElementById('statusDot');
    if (active) dot.classList.add('active');
    else dot.classList.remove('active');
}

/* Cập nhật trạng thái nút */
function updateButtonStates(cameraOn) {
    const startBtn  = document.getElementById('startBtn');
    const captureBtn = document.getElementById('captureBtn');
    const switchBtn = document.getElementById('switchBtn');

    if (cameraOn) {
        startBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="22" height="22"><path d="M6 6h12v12H6z" fill="currentColor"/></svg>
            <span>Tắt Camera</span>
        `;
        startBtn.classList.remove('btn-pulse');
        captureBtn.disabled = false;
        switchBtn.disabled = false;
    } else {
        startBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="22" height="22"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>
            <span>Bật Camera</span>
        `;
        startBtn.classList.add('btn-pulse');
        captureBtn.disabled = true;
        switchBtn.disabled = true;
        document.getElementById('downloadBtn').disabled = true;
    }
}

/* Hiện/ẩn cảnh báo không có khuôn mặt */
function showNoFaceAlert(show) {
    const alert = document.getElementById('noFaceAlert');
    if (show) alert.classList.add('show');
    else alert.classList.remove('show');
}

/* Hiện/ẩn cảnh báo quá nhiều người */
function showTooManyAlert(show) {
    document.getElementById('tooManyAlert').classList.toggle('show', show);
}

/* Hiện/ẩn cảnh báo nhắm mắt */
function showEyesClosedAlert(show) {
    document.getElementById('eyesClosedAlert').classList.toggle('show', show);
}

/* Hiện/ẩn cảnh báo "hãy cười lên" */
function showSmileRequiredAlert(show) {
    document.getElementById('smileRequiredAlert').classList.toggle('show', show);
}

/* Reset kết quả về ban đầu */
function resetResults() {
    document.getElementById('faceCount').textContent = '0';
    document.getElementById('smileStatus').textContent = '—';
    document.getElementById('smileStatus').style.color = '';
    document.getElementById('headAngle').textContent = '—';
    document.getElementById('headAngle').style.color = '';
    document.getElementById('eyeStatus').textContent = '—';
    document.getElementById('eyeStatus').style.color = '';
    document.getElementById('lookingStatus').textContent = '—';
    document.getElementById('lookingStatus').style.color = '';
    document.getElementById('emotionList').innerHTML =
        '<p class="emotion-empty">Chưa có dữ liệu. Bật camera và chụp ảnh để phân tích.</p>';
    showTooManyAlert(false);
    showEyesClosedAlert(false);
    showSmileRequiredAlert(false);
}

/* Lấy cảm xúc có xác suất cao nhất */
function getTopEmotion(expressions) {
    let maxKey = 'neutral';
    let maxProb = 0;
    for (const [key, prob] of Object.entries(expressions)) {
        if (prob > maxProb) {
            maxProb = prob;
            maxKey = key;
        }
    }
    return { key: maxKey, prob: maxProb };
}

/* Màu sắc cho mỗi cảm xúc (dùng cho bounding box) */
function getEmotionColor(emotionKey) {
    const colors = {
        happy:     '#00b894',
        sad:       '#0984e3',
        angry:     '#e74c3c',
        surprised: '#fdcb6e',
        fearful:   '#6c5ce7',
        disgusted: '#00cec9',
        neutral:   '#b2bec3'
    };
    return colors[emotionKey] || '#b2bec3';
}

/* =========================================================
   13. XỬ LÝ SỰ KIỆN CỬA SỔ
   ========================================================= */

// Xử lý khi resize cửa sổ
window.addEventListener('resize', () => {
    if (stream && video.readyState >= 2) {
        resizeCanvas();
    }
});

// Dừng camera khi đóng tab
window.addEventListener('beforeunload', () => {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
    }
});
async function uploadToCloudinary(dataURL) {
    const formData = new FormData();
    formData.append("file", dataURL);
    formData.append("upload_preset", "nhatminhdz");

    try {
        const res = await fetch(
            "https://api.cloudinary.com/v1_1/izdarxqm/image/upload",
            {
                method: "POST",
                body: formData
            }
        );

        const data = await res.json();

        console.log("Upload thành công:", data.secure_url);

        // Hiển thị link
        alert("Đã upload!\n\n" + data.secure_url);

    } catch (err) {
        console.error(err);
        alert("Upload thất bại!");
    }
}