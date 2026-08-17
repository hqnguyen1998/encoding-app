# Đảo Phim Encoding

Ứng dụng desktop encode video thành HLS trên macOS và Windows. Encode diễn ra cục bộ bằng FFmpeg; kết quả được upload và tạo video thông qua tài khoản OnzLoad.

## Chức năng hiện có

- Chọn nhiều hoặc kéo thả nhiều MP4, MKV, MOV, AVI, WebM, M4V và MPEG-TS vào encode queue.
- Encode tuần tự từng video; hiển thị trạng thái, tiến độ, lỗi riêng cho từng mục và cho phép dừng, chạy tiếp, thử lại hoặc xóa mục khỏi queue.
- Đọc codec, độ phân giải, thời lượng và kích thước bằng ffprobe.
- Chế độ **Siêu nhanh · Copy** giữ nguyên video H.264, chuyển bitstream sang Annex B khi xuất MPEG-TS và chỉ chuyển audio đầu tiên sang AAC 192 kbps.
- Giải mã thử video từ `master.m3u8` trước khi báo hoàn tất; HLS lỗi sẽ không được đưa vào auto-upload.
- Tự kiểm tra khả năng encode H.264 bằng GPU thật khi khởi động; chế độ **Tự động** ưu tiên GPU hoạt động và tự quay về CPU x264 nếu máy không hỗ trợ.
- Hỗ trợ Apple VideoToolbox trên macOS; NVIDIA NVENC, Intel Quick Sync và AMD AMF trên Windows khi FFmpeg và phần cứng/driver tương ứng khả dụng.
- Cho phép chọn rõ **Tự động**, **CPU · x264** hoặc GPU đã vượt qua bài kiểm tra thực tế ngay trong màn hình encode.
- Bảng **Cấu hình nâng cao** cho phép chỉnh bitrate video theo preset, CRF x264, H.264 profile, FPS, khoảng keyframe, thuật toán scale và khử interlace YADIF.
- Đóng logo PNG/JPG/WebP/BMP lên video với vị trí, kích thước, độ trong suốt và lề tùy chỉnh; áp dụng đồng nhất lên mọi rendition HLS và tự lưu cấu hình.
- Tùy chỉnh AAC bitrate, số kênh, sample rate; chọn segment MPEG-TS `.ts` hoặc fragmented MP4 `.m4s` và số thứ tự segment bắt đầu.
- Chỉ có hai màn hình chính: **Encode HLS** và **Upload OnzLoad**; không có tab Cloud Storage hoặc cấu hình R2/S3 trên máy người dùng.
- Liên kết tài khoản **OnzLoad** qua trình duyệt và PKCE; token thiết bị được mã hóa bằng kho khóa của hệ điều hành.
- Có thể tự upload sau mỗi encode hoặc chọn nhiều thư mục HLS đã có. OnzLoad tự chọn storage, cấp quyền upload tạm thời, kiểm tra HLS và tạo video/job trong database.
- Hiển thị hàng đợi, byte, tốc độ, ETA và link embed của từng video; hỗ trợ dừng, thử lại, sao chép hoặc mở video vừa tạo.
- Tự lưu cấu hình encode, tùy chọn nâng cao, thư mục đầu ra và lựa chọn auto-upload. Encoder không lưu Access Key, Secret Key, endpoint, bucket hoặc URL CDN.
- Liệt kê subtitle nhúng theo đúng stream index, codec, ngôn ngữ, tiêu đề và cờ default/forced.
- Chọn một hoặc nhiều subtitle track và xuất hàng loạt; SRT/ASS/WebVTT được giữ nguyên, `mov_text` chuyển sang SRT, PGS xuất SUP và subtitle ảnh khác xuất MKS.
- Xuất HLS adaptive 1080p/720p/480p hoặc 720p/480p/360p.
- Tự bỏ rendition cao hơn độ phân giải nguồn, không upscale video nhỏ.
- Chế độ một chất lượng giữ độ phân giải nguồn.
- H.264/x264 + AAC, segment MPEG-TS, master playlist `master.m3u8`.
- Theo dõi phần trăm, FPS đầu ra thật của HLS, tốc độ xử lý, ETA và log FFmpeg; hỗ trợ hủy tác vụ.
- Mỗi lần encode tạo thư mục mới nên không xóa hoặc ghi đè kết quả cũ.

## Chạy khi phát triển

Yêu cầu Node.js 22 trở lên.

```bash
npm install
npm run dev
```

## Kiểm tra

```bash
npm run typecheck
npm test
npm run smoke:encode
```

Smoke test tạo một video 720p có subtitle SRT nhúng trong thư mục tạm, kiểm tra HLS Copy video có Annex B và giải mã lại được, ba rendition adaptive, cấu hình nâng cao fMP4 nhiều rendition, encode thêm bằng GPU nếu máy có encoder hoạt động, kiểm tra engine truyền file nội bộ và xuất lại subtitle trước khi tự dọn dữ liệu tạm.

## Cấu hình encode nâng cao

Bảng nâng cao mặc định được thu gọn và giữ nguyên hành vi encode an toàn của preset. Mỗi item trong queue nhận một bản chụp cấu hình riêng tại thời điểm bắt đầu queue, nên thay đổi sau đó không làm sai cấu hình của item đang chạy.

- **Bitrate video** dùng phần trăm so với ladder của preset. Với GPU đây là bitrate đích; với CPU x264 đây là giới hạn maxrate trong khi CRF điều khiển chất lượng.
- **CRF CPU x264** để trống sẽ theo lựa chọn Nhanh/Cân bằng/Chất lượng. CRF không áp dụng cho GPU.
- **FPS, keyframe, profile, scale và YADIF** chỉ áp dụng khi encode lại video; chế độ Copy giữ nguyên bitstream video nguồn.
- **Audio & HLS** áp dụng cho cả Copy và Adaptive. fMP4 tạo `init_*.mp4` và segment `.m4s`; MPEG-TS vẫn là mặc định tương thích rộng.
- App chuẩn hóa và giới hạn mọi giá trị số trước khi tạo lệnh FFmpeg; nút **Đặt lại** phục hồi toàn bộ mặc định.

## Đóng logo vào video

Bật **Đóng logo vào video** trong phần cấu hình luồng, chọn ảnh và chỉnh vị trí, kích thước, độ trong suốt hoặc lề. Kích thước và lề tính theo phần trăm chiều rộng của từng rendition nên logo giữ tỷ lệ tương đương trên 1080p, 720p và 480p. Logo được chụp riêng cho từng item khi bắt đầu queue.

Đóng logo cần xử lý lại từng frame, vì vậy không dùng được với **Siêu nhanh · Copy**. Khi bật logo từ Copy, app tự chuyển sang **Một chất lượng**; sau đó có thể chọn Adaptive nếu cần nhiều chất lượng. Bộ lọc overlay chạy bằng CPU, còn encode H.264 vẫn có thể dùng GPU.

## Upload qua OnzLoad

Trong tab **Upload OnzLoad**, bấm **Đăng nhập OnzLoad**. Trình duyệt yêu cầu người dùng xác nhận thiết bị; sau callback PKCE, token thiết bị được mã hóa bằng kho khóa của hệ điều hành.

Người dùng không nhập hoặc lưu thông tin R2. Khi bắt đầu upload, encoder gửi danh sách file HLS cho OnzLoad; server chọn storage đang hoạt động và cấp URL PUT ký sẵn theo từng file. File đi thẳng từ máy người dùng lên R2, còn Access Key và Secret Access Key luôn ở phía server.

Bật **Tự upload và tạo video sau mỗi encode** để đầu ra được chuẩn hóa H.264/yuv420p + AAC-LC stereo 48 kHz. Sau khi truyền file, OnzLoad xác minh playlist/segment ở phía server rồi hoàn tất `MediaAsset` và `EncodeJob`; encoder chỉ nhận lại link embed.

Encoder không nhận credential storage, không dùng rclone, không kết nối trực tiếp PostgreSQL/Prisma và không có quyền duyệt, sửa hoặc xóa các object khác trong bucket.

## Tạo bộ cài

Trên Windows, lệnh đóng gói tự sao chép FFmpeg/FFprobe từ dependency đã cài bằng `npm ci` vào `vendor/`. Binary sinh ra không được commit vào Git. macOS dùng trực tiếp FFmpeg/FFprobe từ dependency đã đóng gói.

Trên macOS:

```bash
npm run dist:mac
```

Kết quả nằm trong `release/Dao-Phim-Encoding-0.14.0-arm64.dmg` hoặc bản kiến trúc tương ứng với máy build.

Trên Windows x64:

```powershell
npm ci
npm run dist:win
```

Kết quả nằm trong `release/Dao-Phim-Encoding-Setup-0.14.0-x64.exe`. Windows installer nên được build trên Windows để dependency FFmpeg/ffprobe đúng nền tảng. Workflow `.github/workflows/build-installers.yml` tạo cả hai artifact; khi push tag `v*`, workflow cũng phát hành GitHub Release kèm checksum SHA-256.

## Cấu trúc output

```text
ten-video-hls/
├── master.m3u8
├── v0/
│   ├── index.m3u8
│   └── segment_00000.ts
├── v1/
└── v2/
```

## Lưu ý phát hành

Chế độ Copy chỉ bật khi video nguồn là H.264. Vì video không được encode lại, độ dài segment phụ thuộc keyframe sẵn có trong nguồn và có thể không đúng chính xác số giây đã chọn. Với HEVC/AV1 hoặc khi cần nhiều chất lượng/keyframe thẳng hàng, hãy dùng preset Adaptive.

GPU chỉ đảm nhiệm encode video H.264. Bộ lọc scale nhiều độ phân giải và encode audio AAC hiện vẫn chạy bằng CPU. Chế độ Copy không encode lại video nên thường nhanh nhất và không cần GPU.

Danh sách GPU trong app không chỉ dựa vào tên encoder được biên dịch trong FFmpeg: app thử encode một frame và chỉ hiển thị encoder chạy thành công. Trên Windows, cần cài driver GPU phù hợp; nếu GPU lỗi hoặc không khả dụng, chế độ Tự động dùng CPU x264.

App đóng gói FFmpeg có hỗ trợ `libx264`. Khi phân phối công khai, cần giữ thông báo bản quyền và tuân thủ giấy phép GPL/LGPL tương ứng của bản FFmpeg được dùng. Bộ cài hiện chưa ký số; phát hành thương mại nên bổ sung Apple Developer ID/notarization và Windows code signing để tránh cảnh báo Gatekeeper/SmartScreen.
