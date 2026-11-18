"use client";

import { useState } from "react";
import {
  ClaimLabelValues,
  type BrandFact,
  type ClaimLabel,
  type ContentBlock,
} from "@/lib/supabase/types";

export interface VisualBlockEditorProps {
  articleId: string;
  initialSlug: string;
  initialSeoTitle: string;
  initialSeoMetaDescription: string;
  initialBlocks: ContentBlock[];
  availableAssets: Array<{ id: string; alt_text: string | null }>;
  availableFacts: BrandFact[];
  saveAction: (formData: FormData) => Promise<void>;
}

const BLOCK_TYPE_LABELS: Record<ContentBlock["type"], string> = {
  h2: "Tiêu đề chính (H2)",
  h3: "Tiêu đề phụ (H3)",
  paragraph: "Đoạn văn (Paragraph)",
  list: "Danh sách (List)",
  table: "Bảng biểu (Table)",
  image: "Hình ảnh (Image)",
  callout: "Khối điểm nhấn (Callout)",
  faq: "Câu hỏi thường gặp (FAQ)",
};

export function VisualBlockEditor({
  articleId,
  initialSlug,
  initialSeoTitle,
  initialSeoMetaDescription,
  initialBlocks,
  availableAssets,
  availableFacts,
  saveAction,
}: VisualBlockEditorProps) {
  const [slug, setSlug] = useState(initialSlug);
  const [seoTitle, setSeoTitle] = useState(initialSeoTitle);
  const [seoMeta, setSeoMeta] = useState(initialSeoMetaDescription);
  const [blocks, setBlocks] = useState<ContentBlock[]>(initialBlocks);
  const [showRawJson, setShowRawJson] = useState(false);
  const [rawJsonDraft, setRawJsonDraft] = useState(() =>
    JSON.stringify(initialBlocks, null, 2)
  );
  const [jsonError, setJsonError] = useState<string | null>(null);

  function syncBlocks(next: ContentBlock[]) {
    setBlocks(next);
    setRawJsonDraft(JSON.stringify(next, null, 2));
    setJsonError(null);
  }

  function moveBlock(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= blocks.length) return;
    const copy = [...blocks];
    const [removed] = copy.splice(index, 1);
    copy.splice(target, 0, removed);
    syncBlocks(copy);
  }

  function removeBlock(index: number) {
    if (blocks.length <= 1) return;
    const copy = blocks.filter((_, idx) => idx !== index);
    syncBlocks(copy);
  }

  function addBlock(type: ContentBlock["type"]) {
    const defaultAssetId = availableAssets[0]?.id ?? "asset-demo";
    let newBlock: ContentBlock;

    switch (type) {
      case "h2":
        newBlock = { type: "h2", text: "Tiêu đề mục H2 mới" };
        break;
      case "h3":
        newBlock = { type: "h3", text: "Tiêu đề phụ H3 mới" };
        break;
      case "paragraph":
        newBlock = {
          type: "paragraph",
          text: "Nhập nội dung đoạn văn trả lời trực tiếp...",
          fact_ids: [],
          claim_label: "GENERAL_KNOWLEDGE",
        };
        break;
      case "list":
        newBlock = {
          type: "list",
          ordered: false,
          items: ["Ý chính số 1", "Ý chính số 2"],
          fact_ids: [],
          claim_label: "GENERAL_KNOWLEDGE",
        };
        break;
      case "table":
        newBlock = {
          type: "table",
          caption: "Bảng thông số so sánh",
          headers: ["Tiêu chí", "Giá trị"],
          rows: [["Thông số A", "Chi tiết A"]],
          fact_ids: [],
          claim_label: "GENERAL_KNOWLEDGE",
        };
        break;
      case "image":
        newBlock = {
          type: "image",
          asset_id: defaultAssetId,
          alt: availableAssets[0]?.alt_text ?? "Hình ảnh minh họa bài viết",
          caption: "",
        };
        break;
      case "callout":
        newBlock = {
          type: "callout",
          title: "Điểm lưu ý quan trọng",
          text: "Nội dung tóm tắt hoặc lưu ý dành cho người đọc.",
          fact_ids: [],
          claim_label: "GENERAL_KNOWLEDGE",
        };
        break;
      case "faq":
        newBlock = {
          type: "faq",
          q: "Câu hỏi thường gặp mới?",
          a: "Câu trả lời ngắn gọn, trực diện từ 5 đến dưới 300 từ.",
          fact_ids: [],
          claim_label: "GENERAL_KNOWLEDGE",
        };
        break;
    }

    syncBlocks([...blocks, newBlock]);
  }

  function updateBlockAt(index: number, updated: ContentBlock) {
    const copy = [...blocks];
    copy[index] = updated;
    syncBlocks(copy);
  }

  function handleRawJsonChange(val: string) {
    setRawJsonDraft(val);
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) {
        setBlocks(parsed as ContentBlock[]);
        setJsonError(null);
      } else {
        setJsonError("JSON phải là một mảng các khối content_blocks.");
      }
    } catch (err) {
      setJsonError(
        err instanceof Error ? err.message : "JSON không hợp lệ"
      );
    }
  }

  return (
    <form
      action={saveAction}
      className="rounded border border-slate-300 bg-slate-50 p-5 space-y-5"
    >
      <input type="hidden" name="article_id" value={articleId} />
      <input
        type="hidden"
        name="content_blocks_json"
        value={JSON.stringify(blocks)}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
        <div>
          <h3 className="text-base font-bold text-slate-900">
            ✏️ Trình Chỉnh sửa Trực quan Nội dung & SEO (Phase 2 Visual Editor)
          </h3>
          <p className="text-xs text-slate-600">
            Chỉnh sửa trực tiếp SEO Metadata và từng khối nội dung (`h2`, `h3`,
            `paragraph`, `list`, `table`, `image`, `callout`, `faq`). Khi bấm
            Lưu, hệ thống tự động chạy lại Truth Guard và bộ 6 kiểm tra + chấm
            điểm 100 điểm.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowRawJson((prev) => !prev)}
          className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
        >
          {showRawJson
            ? "Chuyển về Chế độ Khối Trực quan"
            : "Xem / Sửa JSON Nâng cao"}
        </button>
      </div>

      {/* Khối SEO Metadata */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-white p-4 rounded border border-slate-200">
        <div className="md:col-span-2">
          <label
            htmlFor="editor_seo_title"
            className="block text-xs font-semibold text-slate-700 mb-1"
          >
            SEO Title (`seo.title` — chuẩn 10–60 ký tự, hiện tại:{" "}
            <span
              className={
                seoTitle.length >= 10 && seoTitle.length <= 60
                  ? "text-emerald-700"
                  : "text-red-600"
              }
            >
              {seoTitle.length}/60 ký tự
            </span>
            )
          </label>
          <input
            id="editor_seo_title"
            name="seo_title"
            type="text"
            required
            value={seoTitle}
            onChange={(e) => setSeoTitle(e.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-900"
          />
        </div>

        <div>
          <label
            htmlFor="editor_slug"
            className="block text-xs font-semibold text-slate-700 mb-1"
          >
            URL Slug (`slug`)
          </label>
          <input
            id="editor_slug"
            name="slug"
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm font-mono text-slate-900"
          />
        </div>

        <div className="md:col-span-3">
          <label
            htmlFor="editor_seo_meta"
            className="block text-xs font-semibold text-slate-700 mb-1"
          >
            Meta Description (`seo.meta_description` — chuẩn 30–155 ký tự, hiện
            tại:{" "}
            <span
              className={
                seoMeta.length >= 30 && seoMeta.length <= 155
                  ? "text-emerald-700"
                  : "text-red-600"
              }
            >
              {seoMeta.length}/155 ký tự
            </span>
            )
          </label>
          <textarea
            id="editor_seo_meta"
            name="seo_meta_description"
            rows={2}
            required
            value={seoMeta}
            onChange={(e) => setSeoMeta(e.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-900"
          />
        </div>
      </div>

      {/* Gợi ý danh sách fact_ids có sẵn trong brand_profile */}
      {availableFacts.length > 0 ? (
        <details className="rounded border border-slate-200 bg-white p-3 text-xs">
          <summary className="cursor-pointer font-semibold text-slate-800">
            📌 Tra cứu nhanh danh sách Dữ kiện đã xác thực (`brand_profile.facts`
            — {availableFacts.length} facts)
          </summary>
          <ul className="mt-2 space-y-1 text-slate-700 pl-4 list-disc">
            {availableFacts.map((f) => (
              <li key={f.id}>
                <code>{f.id}</code> ({f.category}): {f.statement}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {showRawJson ? (
        <div className="space-y-2">
          <label className="block text-xs font-semibold text-slate-700">
            Mảng `content_blocks` dạng JSON:
          </label>
          <textarea
            rows={14}
            value={rawJsonDraft}
            onChange={(e) => handleRawJsonChange(e.target.value)}
            className="w-full font-mono text-xs rounded border border-slate-300 bg-white p-3 text-slate-900"
          />
          {jsonError ? (
            <div className="text-xs text-red-700 font-medium">
              Lỗi cú pháp JSON: {jsonError}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          {blocks.map((block, idx) => (
            <div
              key={idx}
              className="rounded border border-slate-200 bg-white p-4 space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-slate-900 px-2 py-0.5 text-[11px] font-semibold text-white">
                    #{idx + 1} · {BLOCK_TYPE_LABELS[block.type]}
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => moveBlock(idx, -1)}
                    disabled={idx === 0}
                    className="rounded border border-slate-200 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                  >
                    ↑ Lên
                  </button>
                  <button
                    type="button"
                    onClick={() => moveBlock(idx, 1)}
                    disabled={idx === blocks.length - 1}
                    className="rounded border border-slate-200 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                  >
                    ↓ Xuống
                  </button>
                  <button
                    type="button"
                    onClick={() => removeBlock(idx)}
                    disabled={blocks.length <= 1}
                    className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-xs text-red-700 hover:bg-red-100 disabled:opacity-40"
                  >
                    ✕ Xóa
                  </button>
                </div>
              </div>

              {/* Nội dung theo từng loại block */}
              {block.type === "h2" || block.type === "h3" ? (
                <div>
                  <input
                    type="text"
                    value={block.text}
                    onChange={(e) =>
                      updateBlockAt(idx, { ...block, text: e.target.value })
                    }
                    className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-900"
                  />
                </div>
              ) : null}

              {block.type === "paragraph" ? (
                <div className="space-y-2">
                  <textarea
                    rows={3}
                    value={block.text}
                    onChange={(e) =>
                      updateBlockAt(idx, { ...block, text: e.target.value })
                    }
                    className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-900"
                  />
                </div>
              ) : null}

              {block.type === "callout" ? (
                <div className="space-y-2">
                  <input
                    type="text"
                    placeholder="Tiêu đề khối điểm nhấn (tùy chọn)"
                    value={block.title ?? ""}
                    onChange={(e) =>
                      updateBlockAt(idx, { ...block, title: e.target.value })
                    }
                    className="w-full rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-900"
                  />
                  <textarea
                    rows={2}
                    value={block.text}
                    onChange={(e) =>
                      updateBlockAt(idx, { ...block, text: e.target.value })
                    }
                    className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-900"
                  />
                </div>
              ) : null}

              {block.type === "list" ? (
                <div className="space-y-2">
                  <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={block.ordered}
                      onChange={(e) =>
                        updateBlockAt(idx, {
                          ...block,
                          ordered: e.target.checked,
                        })
                      }
                    />
                    Danh sách đánh số thứ tự (`ordered`)
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Mỗi dòng là 1 mục danh sách"
                    value={block.items.join("\n")}
                    onChange={(e) =>
                      updateBlockAt(idx, {
                        ...block,
                        items: e.target.value
                          .split(/\r?\n/)
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                    className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-900"
                  />
                </div>
              ) : null}

              {block.type === "table" ? (
                <div className="space-y-2 text-xs">
                  <input
                    type="text"
                    placeholder="Chú thích bảng (caption)"
                    value={block.caption ?? ""}
                    onChange={(e) =>
                      updateBlockAt(idx, { ...block, caption: e.target.value })
                    }
                    className="w-full rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-900"
                  />
                  <div>
                    <span className="font-semibold text-slate-700">
                      Cột tiêu đề (phân cách bằng dấu `|`):
                    </span>
                    <input
                      type="text"
                      value={block.headers.join(" | ")}
                      onChange={(e) =>
                        updateBlockAt(idx, {
                          ...block,
                          headers: e.target.value
                            .split("|")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        })
                      }
                      className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5 font-mono text-xs text-slate-900"
                    />
                  </div>
                  <div>
                    <span className="font-semibold text-slate-700">
                      Các dòng dữ liệu (mỗi dòng 1 hàng, các ô phân cách bằng dấu
                      `|`):
                    </span>
                    <textarea
                      rows={3}
                      value={block.rows.map((r) => r.join(" | ")).join("\n")}
                      onChange={(e) =>
                        updateBlockAt(idx, {
                          ...block,
                          rows: e.target.value
                            .split(/\r?\n/)
                            .filter((line) => line.trim().length > 0)
                            .map((line) =>
                              line.split("|").map((cell) => cell.trim())
                            ),
                        })
                      }
                      className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5 font-mono text-xs text-slate-900"
                    />
                  </div>
                </div>
              ) : null}

              {block.type === "image" ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Chọn `asset_id`
                    </label>
                    <input
                      type="text"
                      value={block.asset_id}
                      onChange={(e) =>
                        updateBlockAt(idx, {
                          ...block,
                          asset_id: e.target.value,
                        })
                      }
                      list={`assets-list-${articleId}`}
                      className="w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono text-xs text-slate-900"
                    />
                    <datalist id={`assets-list-${articleId}`}>
                      {availableAssets.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.alt_text ?? a.id}
                        </option>
                      ))}
                    </datalist>
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Văn bản thay thế (`alt` ≤ 125 ký tự — {block.alt.length}
                      /125)
                    </label>
                    <input
                      type="text"
                      value={block.alt}
                      onChange={(e) =>
                        updateBlockAt(idx, { ...block, alt: e.target.value })
                      }
                      className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Chú thích ảnh (`caption`)
                    </label>
                    <input
                      type="text"
                      value={block.caption ?? ""}
                      onChange={(e) =>
                        updateBlockAt(idx, {
                          ...block,
                          caption: e.target.value,
                        })
                      }
                      className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900"
                    />
                  </div>
                </div>
              ) : null}

              {block.type === "faq" ? (
                <div className="space-y-2">
                  <input
                    type="text"
                    placeholder="Câu hỏi FAQ (q)"
                    value={block.q}
                    onChange={(e) =>
                      updateBlockAt(idx, { ...block, q: e.target.value })
                    }
                    className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-900"
                  />
                  <textarea
                    rows={2}
                    placeholder="Câu trả lời (a — từ 5 đến dưới 300 từ)"
                    value={block.a}
                    onChange={(e) =>
                      updateBlockAt(idx, { ...block, a: e.target.value })
                    }
                    className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-900"
                  />
                </div>
              ) : null}

              {/* Nhãn dữ kiện (claim_label) & fact_ids cho các block nội dung */}
              {"fact_ids" in block ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-slate-100 text-xs">
                  <div>
                    <label className="block font-medium text-slate-600 mb-1">
                      Nhãn sự thật (`claim_label`)
                    </label>
                    <select
                      value={block.claim_label ?? "VERIFIED"}
                      onChange={(e) =>
                        updateBlockAt(idx, {
                          ...block,
                          claim_label: e.target.value as ClaimLabel,
                        })
                      }
                      className="w-full rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-900 bg-white"
                    >
                      {ClaimLabelValues.map((lbl) => (
                        <option key={lbl} value={lbl}>
                          {lbl}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block font-medium text-slate-600 mb-1">
                      Mã dữ kiện (`fact_ids`, phân cách bằng dấu phẩy)
                    </label>
                    <input
                      type="text"
                      placeholder="Ví dụ: fact-01, fact-02"
                      value={(block.fact_ids ?? []).join(", ")}
                      onChange={(e) =>
                        updateBlockAt(idx, {
                          ...block,
                          fact_ids: e.target.value
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        })
                      }
                      className="w-full rounded border border-slate-300 px-2.5 py-1 font-mono text-xs text-slate-900"
                    />
                  </div>
                </div>
              ) : null}
            </div>
          ))}

          {/* Thanh công cụ thêm block mới */}
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <span className="text-xs font-semibold text-slate-700">
              + Thêm khối mới:
            </span>
            {(Object.keys(BLOCK_TYPE_LABELS) as ContentBlock["type"][]).map(
              (t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => addBlock(t)}
                  className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-100"
                >
                  + {t.toUpperCase()}
                </button>
              )
            )}
          </div>
        </div>
      )}

      <div className="pt-3 border-t border-slate-200 flex items-center justify-between">
        <span className="text-xs text-slate-600">
          Tổng số khối hiện tại: <strong>{blocks.length}</strong> blocks
        </span>
        <button
          type="submit"
          disabled={Boolean(jsonError)}
          className="rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          💾 Lưu chỉnh sửa Nội dung & Chạy lại Kiểm tra Tự động
        </button>
      </div>
    </form>
  );
}

