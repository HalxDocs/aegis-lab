export function Logo({ sub = true }: { sub?: boolean }) {
  return (
    <span className="logo" aria-label="Aegis">
      <svg className="logo__mark" viewBox="0 0 48 48" aria-hidden="true" fill="none">
        <g strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M24 10.4 10.8 36.2" opacity="0.9" />
          <path d="M24 10.4 37.2 36.2" opacity="0.9" />
          <path d="M12.6 36.2h7.2" opacity="0.35" />
          <path d="M28.2 36.2h7.2" opacity="0.35" />
          <path className="pulse" d="M2 24h11l4-6.5 4.5 13 4-6.5H46" opacity="0.95" />
          <path d="M32 24h14" opacity="0.18" />
          <circle cx="24" cy="8" r="2.6" fill="currentColor" stroke="none" />
          <circle cx="8" cy="38" r="2.6" fill="currentColor" stroke="none" />
          <circle cx="40" cy="38" r="2.6" fill="currentColor" stroke="none" />
        </g>
      </svg>
      <span>
        <span className="logo__word">Aegis</span>
        {sub && <span className="logo__sub">Failure lab</span>}
      </span>
    </span>
  );
}
