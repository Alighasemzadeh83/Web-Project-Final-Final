export default function Loading() {
  return (
    <div className="fullscreen-loader">
      <div className="card loader-card">
        <div className="loader-spinner" />
        <h3 style={{ margin: "4px 0 2px" }}>Loading frontend</h3>
        <p className="muted" style={{ margin: 0 }}>Please wait...</p>
      </div>
    </div>
  );
}
