import { ImageResponse } from 'next/og';

/*
  The Home Screen icon, as a PNG, because iOS will not take an SVG for one.

  app/icon.svg is the browser tab's favicon and stays the source of the design;
  this is the same mark — the emerald-to-teal square with a check in it — drawn
  at the 180px Apple asks for. Two copies of a rounded square and a tick is
  cheaper than a binary asset in the repo that nobody can edit.
*/

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #10b981 0%, #14b8a6 100%)',
        }}
      >
        <svg width="112" height="112" viewBox="0 0 32 32" fill="none">
          <path
            d="M8 16.5l5 5L24 10.5"
            stroke="#ffffff"
            strokeWidth="3.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    ),
    size
  );
}
