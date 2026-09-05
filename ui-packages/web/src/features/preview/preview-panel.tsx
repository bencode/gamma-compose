export const PreviewPanel = () => (
  <section className="preview-surface" aria-labelledby="preview-title">
    <div className="preview-empty">
      <span className="preview-glyph" aria-hidden="true">
        ⟨γ⟩
      </span>
      <h2 id="preview-title">页面将在这里呈现</h2>
      <p>编译器尚未接入</p>
      <p className="preview-hint">切换左上角的「文件」，先看看示例源码。</p>
    </div>
  </section>
)
