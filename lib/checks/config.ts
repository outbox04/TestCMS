/**
 * Cấu hình ngưỡng kiểm tra tự động và xử lý ảnh.
 * Mỗi hằng số đều ghi chú mã quy tắc [R-xx] trong docs/knowledge/RULES.md
 * hoặc ghi rõ "mặc định, không có trong RULES".
 */
export const CHECK_CONFIG = {
  /** [R-10] Resize ảnh đầu vào về cạnh dài tối đa <= 1568px trước khi gửi lên LLM */
  IMAGE_MAX_EDGE: 1568,

  /** [R-11] Chuyển đổi ảnh sang bản phân tích JPEG nén tối ưu */
  IMAGE_JPEG_QUALITY: 82,

  /** [R-12] Mô tả ảnh ngắn gọn <= 40 từ */
  IMAGE_DESCRIPTION_MAX_WORDS: 40,

  /** [R-17] Văn bản thay thế (alt text) của ảnh không rỗng và <= 125 ký tự */
  IMAGE_ALT_MAX_CHARS: 125,

  /** mặc định, không có trong RULES — độ dài tối thiểu của meta title */
  TITLE_MIN_CHARS: 10,

  /** [R-20] Giới hạn meta_title <= 60 ký tự */
  TITLE_MAX_CHARS: 60,

  /** [R-28] Giới hạn Article.headline trong JSON-LD <= 110 ký tự */
  SCHEMA_HEADLINE_MAX_CHARS: 110,

  /** mặc định, không có trong RULES — độ dài tối thiểu của meta_description */
  META_DESC_MIN_CHARS: 30,

  /** [R-20] Giới hạn meta_description <= 155 ký tự */
  META_DESC_MAX_CHARS: 155,

  /** [R-19] Từ khóa chính phải xuất hiện trong 100 từ đầu tiên */
  PRIMARY_KEYWORD_INTRO_WORDS: 100,

  /** [R-19] Bài viết phải có tối thiểu 2 thẻ H2 */
  MIN_H2_COUNT: 2,

  /** [R-29] Mảng FAQ phải chứa tối thiểu 1 câu hỏi khi bài có FAQ */
  MIN_FAQ_COUNT: 1,

  /** [R-08] Số lượng câu hỏi FAQ tối đa cho mỗi bài là 6 (và <= 10 theo [R-29]) */
  MAX_FAQ_COUNT: 6,

  /** mặc định, không có trong RULES — độ dài tối thiểu câu trả lời FAQ (tính theo từ) */
  FAQ_ANSWER_MIN_WORDS: 3,

  /** [R-29] Câu trả lời trực tiếp trong FAQ phải < 300 từ */
  FAQ_ANSWER_MAX_WORDS: 300,

  /** [R-08] Số lượng từ khóa phụ tối đa là 8 */
  MAX_SECONDARY_KEYWORDS: 8,

  /** [R-01] Số lượng gợi ý từ khóa đầu vào tối đa sau khi loại trùng là 30 */
  MAX_KEYWORD_SUGGESTIONS: 30,

  /** [R-34] Số lần thử lại tối đa của hàng đợi worker trước khi ghi last_error */
  WORKER_MAX_RETRIES: 3,

  /** [R-34] Số lần thử lại tối đa của bước write_article khi kiểm tra tự động trượt */
  WRITER_CHECK_MAX_RETRIES: 1,
} as const;

