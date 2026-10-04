export default function HomePage() {
  return (
    <main>
      <section className="status-card" aria-labelledby="control-center-title">
        <div className="brand-mark" aria-hidden="true">
          R
        </div>
        <div>
          <p className="eyebrow">Internal system</p>
          <h1 id="control-center-title">Roco SEO Control Center</h1>
          <p className="summary">
            The Phase 1 foundation is operational. SEO workflows will be added
            only in their approved phases.
          </p>
          <div className="status">
            <span aria-hidden="true" /> Foundation ready
          </div>
        </div>
      </section>
    </main>
  );
}
