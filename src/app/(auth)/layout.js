export default function AuthLayout({ children }) {
  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-gray-50/80">
      {/* Animated gradient orbs */}
      <div className="absolute top-[-30%] left-[-15%] w-[700px] h-[700px] bg-emerald-200/25 rounded-full blur-[160px] animate-[drift_20s_ease-in-out_infinite]" />
      <div className="absolute bottom-[-25%] right-[-10%] w-[500px] h-[500px] bg-teal-200/20 rounded-full blur-[140px] animate-[drift_25s_ease-in-out_infinite_reverse]" />
      <div className="absolute top-[15%] right-[10%] w-[350px] h-[350px] bg-cyan-100/15 rounded-full blur-[120px] animate-[drift_18s_ease-in-out_2s_infinite]" />

      {/* Dot grid */}
      <div
        className="absolute inset-0 opacity-[0.3]"
        style={{
          backgroundImage: 'radial-gradient(circle, #d1d5db 0.7px, transparent 0.7px)',
          backgroundSize: '28px 28px',
        }}
      />

      <div className="relative z-10 w-full max-w-[420px] mx-auto px-6">
        {children}
      </div>
    </div>
  );
}
