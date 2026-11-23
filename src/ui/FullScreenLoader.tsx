export function FullScreenLoader({ label }: { label?: string }) {
  return (
    <div className="fullscreen-loader">
      <div className="spinner" />
      {label && <p>{label}</p>}
    </div>
  );
}
