import { ImageResponse } from "next/og";

/** PNG-иконка приложения для PWA и Apple (рисуется при сборке). */
export function brandIconImage(size: number) {
  const stroke = Math.round(size * 0.11);
  return new ImageResponse(
    (
      <div
        style={{
          width: size,
          height: size,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#07090d",
        }}
      >
        <div
          style={{
            width: size * 0.78,
            height: size * 0.78,
            borderRadius: size * 0.2,
            background: "#d4ff3a",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 64 64">
            <path
              d="M18 54V12h16a13 13 0 0 1 0 26H26"
              stroke="#0a0d12"
              strokeWidth={(stroke / size) * 64 * 1.6}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>
    ),
    { width: size, height: size },
  );
}
