// Logo de the Master Plan: doble R espalda con espalda (una reflejada) que comparten el trazo central.
// El mismo dibujo está en public/logo.svg (icono de la pestaña).
export const APP_NAME = "the Master Plan";

export default function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={APP_NAME}>
      <rect width="64" height="64" rx="16" fill="#c9dcf5" />
      <g fill="none" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M32 15 H24 a9 9 0 0 0 0 18 H32 M27 33 L17 49" stroke="#4f7fbf" />
        <path d="M32 15 H40 a9 9 0 0 1 0 18 H32 M37 33 L47 49" stroke="#e58a68" />
        <path d="M32 15 V49" stroke="#1f3d63" />
      </g>
    </svg>
  );
}
