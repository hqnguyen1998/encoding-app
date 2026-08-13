# Đảo Phim Encoding

Ứng dụng desktop encode video thành HLS trên macOS và Windows. Encode diễn ra cục bộ bằng FFmpeg; upload lên R2/S3 chỉ chạy khi người dùng chủ động bật hoặc bắt đầu tác vụ.

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
- Tab **Upload R2 / S3** riêng để chọn nhiều thư mục HLS local, upload tuần tự theo queue, kiểm tra kết nối và theo dõi byte/tốc độ/ETA.
- Ba mức tốc độ upload rclone: **Ổn định** 8 luồng, **Nhanh** 24 luồng (mặc định) và **Tối đa** 32 luồng; lựa chọn được tự lưu trên máy.
- Có thể tự thêm kết quả vào upload queue sau mỗi lần encode; upload chỉ bắt đầu khi toàn bộ encode queue đã kết thúc.
- App hiển thị nút **Copy URL** ngay tại URL xem trước; sau khi upload thành công cũng xuất URL public tới `master.m3u8` cho từng mục, hỗ trợ sao chép và mở URL.
- Tạo/cập nhật remote Cloudflare R2, Amazon S3 hoặc S3 tương thích ngay trong app. Secret được rclone làm mờ trước khi lưu vào `rclone.conf`, không xuất hiện trong tham số tiến trình hoặc log.
- Tự lưu và khôi phục tab, cấu hình encode, tùy chọn nâng cao, thư mục đầu ra, remote, đường dẫn upload, URL CDN và auto-upload. Secret Key không được ghi dạng plaintext vào localStorage.
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

Smoke test tạo một video 720p có subtitle SRT nhúng trong thư mục tạm, kiểm tra HLS Copy video có Annex B và giải mã lại được, ba rendition adaptive, cấu hình nâng cao fMP4 nhiều rendition, encode thêm bằng GPU nếu máy có encoder hoạt động, rclone copy cục bộ kèm tiến trình JSON, rồi liệt kê và xuất lại subtitle trước khi tự dọn dữ liệu tạm.

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

## Cấu hình upload R2 / S3

Ứng dụng đã đóng gói sẵn rclone 1.75.0 cho macOS ARM64 và Windows x64. Trong tab **Upload R2 / S3**, có thể tạo/cập nhật remote bằng Access Key ID, Secret Access Key, endpoint và region; hoặc dùng remote đã có trong `rclone.conf`. Với remote S3/R2, đường dẫn đích có dạng `ten-bucket/hls`; app sẽ tự nối tên thư mục HLS local, ví dụ `r2:ten-bucket/hls/ten-video-hls`.

Nếu `rclone.conf` được mã hóa toàn bộ, app vẫn dùng được remote hiện có nhưng sẽ không chỉnh sửa file cấu hình đó. Hãy dùng `rclone config` trong Terminal cho trường hợp này.

Upload dùng `rclone copy`, không dùng `sync`: file ở đích không có trong thư mục local sẽ không bị xóa. Sau upload, thư mục HLS local cũng được giữ nguyên.

Với HLS có nhiều segment nhỏ, mức **Nhanh** chạy 24 file song song, 32 checkers và buffer 8 MiB mỗi transfer. Mức **Tối đa** chạy 32 file song song và 64 checkers, phù hợp mạng upload nhanh; nếu gặp lỗi timeout/429 hoặc máy thiếu RAM, chuyển về **Nhanh** hoặc **Ổn định**. Cấu hình được chụp riêng cho từng item khi bắt đầu queue.

Để app xuất URL phát HLS, nhập **URL public / CDN của bucket** ở phần đích upload, ví dụ `https://cdn.daophim.space`. Đây phải là custom domain gắn trực tiếp với bucket hoặc URL `r2.dev` đã bật public access, không phải endpoint API `*.r2.cloudflarestorage.com`. App tự bỏ tên bucket khỏi đường dẫn rclone và ghép object key tới `master.m3u8`; cấu hình này được ghi nhớ riêng theo từng remote trên máy.

## Tạo bộ cài

Các lệnh đóng gói tự chuẩn bị binary cần thiết trong `vendor/`. Rclone 1.75.0 được tải từ trang phát hành chính thức và kiểm tra SHA-256; trên Windows, FFmpeg/FFprobe được sao chép từ dependency đã cài bằng `npm ci`. Binary sinh ra không được commit vào Git.

Trên macOS:

```bash
npm run dist:mac
```

Kết quả nằm trong `release/Dao-Phim-Encoding-0.11.0-arm64.dmg` hoặc bản kiến trúc tương ứng với máy build.

Trên Windows x64:

```powershell
npm ci
npm run dist:win
```

Kết quả nằm trong `release/Dao-Phim-Encoding-Setup-0.11.0-x64.exe`. Windows installer nên được build trên Windows để dependency FFmpeg/ffprobe đúng nền tảng. Workflow `.github/workflows/build-installers.yml` có thể tạo cả hai artifact khi chạy thủ công hoặc push tag `v*`.

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
