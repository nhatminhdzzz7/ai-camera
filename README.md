# 📷 AI Camera — Nhận diện khuôn mặt trên trình duyệt

Website AI Camera hiện đại với dark mode, glassmorphism, chạy 100% trên trình duyệt (client-side) bằng **face-api.js**.

## ✨ Tính năng

- 🎥 Truy cập camera trực tiếp (`getUserMedia`)
- 🤖 Tự động nhận diện khuôn mặt bằng AI
- 😀 Phân tích cảm xúc (7 loại: Vui, Buồn, Tức giận, Sợ hãi, Ngạc nhiên, Ghê tởm, Trung tính)
- 📊 Hiển thị xác suất cảm xúc (%) với thanh tiến trình
- 😊 Phát hiện cười
- 📐 Ước lượng góc quay đầu (yaw + roll)
- 🟦 Vẽ khung (bounding box) quanh khuôn mặt
- 🔵 Hiển thị 68 điểm landmark trên khuôn mặt
- ⚠️ Thông báo khi không phát hiện khuôn mặt
- 🔄 Đổi camera trước/sau (cho điện thoại)
- 💾 Tải ảnh xuống (PNG)
- 🌙 Dark mode + hiệu ứng glassmorphism
- 📱 Responsive (máy tính + điện thoại)

---

## 🚀 Cách chạy

### Bước 1: Tải project về

Giải nén thư mục `ai-camera` ra một chỗ bất kỳ.

### Bước 2: Tải model face-api.js

Bạn cần tải các file model AI vào thư mục `models/`. Có 2 cách:

#### Cách A — Tải bằng lệnh (nếu có git)

```bash
cd ai-camera
git clone https://github.com/justadudewhohacks/face-api.js.git /tmp/faceapi
cp -r /tmp/faceapi/weights/* models/
```

#### Cách B — Tải thủ công (không cần git)

1. Truy cập: https://github.com/justadudewhohacks/face-api.js/tree/master/weights
2. Tải các file sau vào thư mục `models/`:

**Bắt buộc (3 file):**
- `tiny_face_detector_model-weights_manifest.json`
- `tiny_face_detector_model-shard1`
- `face_expression_model-weights_manifest.json`
- `face_expression_model-shard1`
- `face_landmark_68_model-weights_manifest.json`
- `face_landmark_68_model-shard1`

> Hoặc tải nguyên thư mục `weights` và đổi tên thành `models`.

### Bước 3: Chạy server local

> ⚠️ **Bắt buộc phải chạy qua HTTP server** — không mở trực tiếp file `index.html` bằng `file://` vì trình duyệt sẽ chặn tải model và truy cập camera.

#### Cách đơn giản nhất — dùng Python:

```bash
cd ai-camera
python3 -m http.server 8080
```

Sau đó mở trình duyệt: **http://localhost:8080**

#### Hoặc dùng Node.js:

```bash
npx http-server ai-camera -p 8080
```

#### Hoặc dùng VS Code:

Cài extension **Live Server** → Chuột phải vào `index.html` → "Open with Live Server"

---

## 📁 Cấu trúc project

```
ai-camera/
├── index.html        # Giao diện HTML
├── style.css         # Style (dark mode + glassmorphism)
├── script.js         # Logic JavaScript + face-api.js
├── README.md         # File này
└── models/           # Thư mục chứa model AI (cần tải riêng)
    ├── tiny_face_detector_model-weights_manifest.json
    ├── tiny_face_detector_model-shard1
    ├── face_expression_model-weights_manifest.json
    ├── face_expression_model-shard1
    ├── face_landmark_68_model-weights_manifest.json
    └── face_landmark_68_model-shard1
```

---

## 🛠 Công nghệ sử dụng

| Công nghệ | Vai trò |
|---|---|
| HTML5 | Cấu trúc giao diện |
| CSS3 | Dark mode, glassmorphism, animation |
| JavaScript (ES6) | Logic xử lý |
| face-api.js | Nhận diện khuôn mặt + cảm xúc |
| getUserMedia API | Truy cập camera |
| Canvas API | Vẽ bounding box + landmarks |
| Google Fonts | Font Inter + JetBrains Mono |

---

## 📝 Ghi chú

- Model AI chạy hoàn toàn trên trình duyệt, **không gửi dữ liệu lên server**.
- Lần đầu tải model có thể mất vài giây (model ~190KB).
- Camera yêu cầu HTTPS hoặc localhost để hoạt động.
- Trên điện thoại, nút "Đổi camera" sẽ chuyển giữa camera trước/sau.
- Model `tinyFaceDetector` được chọn vì nhẹ và nhanh, phù hợp realtime.
