/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // The app is never meant to be embedded in a frame (clickjacking).
          { key: 'X-Frame-Options', value: 'DENY' },
          // Don't let browsers MIME-sniff responses into executable types.
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Keep full URLs (which can carry ids) off cross-origin referrers.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // The app uses none of these device capabilities.
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
