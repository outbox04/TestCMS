import "@/app/article-theme.css";
import type { ContentBlock } from "@/lib/supabase/types";

export interface ArticleRendererProps {
  title: string;
  publishedAt?: string | null;
  brandName?: string | null;
  blocks: ContentBlock[];
  assetUrlMap?: Record<string, string>;
}

/**
 * Component hiển thị bài viết đồng bộ cho cả màn hình Xem trước (Cổng 2)
 * lẫn trang công khai /blog/[slug] (R-41).
 */
export function ArticleRenderer({
  title,
  publishedAt,
  brandName,
  blocks,
  assetUrlMap = {},
}: ArticleRendererProps) {
  const nonFaqBlocks = blocks.filter((b) => b.type !== "faq");
  const faqBlocks = blocks.filter(
    (b): b is Extract<ContentBlock, { type: "faq" }> => b.type === "faq"
  );

  return (
    <article className="article-theme">
      <header>
        <h1 className="article-title">{title}</h1>
        <div className="article-meta">
          {brandName ? <span>Tác giả: {brandName}</span> : null}
          {publishedAt ? (
            <span>
              {brandName ? " · " : ""}
              Ngày đăng: {new Date(publishedAt).toLocaleDateString("vi-VN")}
            </span>
          ) : null}
          <span> · Nội dung hỗ trợ bởi Content Agent (đã kiểm duyệt)</span>
        </div>
      </header>

      <div>
        {nonFaqBlocks.map((block, index) => {
          switch (block.type) {
            case "h2":
              return (
                <h2 key={index} className="article-h2">
                  {block.text}
                </h2>
              );
            case "h3":
              return (
                <h3 key={index} className="article-h3">
                  {block.text}
                </h3>
              );
            case "paragraph":
              return (
                <p key={index} className="article-paragraph">
                  {block.text}
                </p>
              );
            case "list":
              return block.ordered ? (
                <ol key={index} className="article-list article-list-ol">
                  {block.items.map((item, i) => (
                    <li key={i} className="mb-1">
                      {item}
                    </li>
                  ))}
                </ol>
              ) : (
                <ul key={index} className="article-list article-list-ul">
                  {block.items.map((item, i) => (
                    <li key={i} className="mb-1">
                      {item}
                    </li>
                  ))}
                </ul>
              );
            case "table":
              return (
                <div key={index} className="article-table-wrapper">
                  <table className="article-table">
                    {block.caption ? (
                      <caption className="article-table-caption">
                        {block.caption}
                      </caption>
                    ) : null}
                    <thead>
                      <tr>
                        {block.headers.map((header, hIdx) => (
                          <th key={hIdx} className="article-table-th">
                            {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {block.rows.map((row, rIdx) => (
                        <tr key={rIdx} className="article-table-tr">
                          {row.map((cell, cIdx) => (
                            <td key={cIdx} className="article-table-td">
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            case "image": {
              const src = assetUrlMap[block.asset_id];
              return (
                <figure key={index} className="article-figure">
                  {src ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={src}
                      alt={block.alt}
                      className="article-image"
                      loading="lazy"
                    />
                  ) : (
                    <div className="p-6 text-center text-xs text-slate-500">
                      [Hình ảnh minh họa: {block.alt} (ID: {block.asset_id})]
                    </div>
                  )}
                  <figcaption className="article-figcaption">
                    {block.caption || block.alt}
                  </figcaption>
                </figure>
              );
            }
            case "callout":
              return (
                <aside key={index} className="article-callout">
                  {block.title ? (
                    <div className="font-bold text-slate-900 mb-1">
                      {block.title}
                    </div>
                  ) : null}
                  <p className="text-sm text-slate-800">{block.text}</p>
                </aside>
              );
            default:
              return null;
          }
        })}
      </div>

      {faqBlocks.length > 0 ? (
        <section className="article-faq-section" aria-label="Câu hỏi thường gặp">
          <h2 className="article-h2">Câu hỏi thường gặp (FAQ)</h2>
          <div>
            {faqBlocks.map((faq, idx) => (
              <div key={idx} className="article-faq-item">
                <h3 className="font-semibold text-base text-slate-900 mb-1">
                  {faq.q}
                </h3>
                <p className="text-sm text-slate-700">{faq.a}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </article>
  );
}

