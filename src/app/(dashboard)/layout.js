import Navbar from "@/components/Navbar";
import AuthGate from "@/components/AuthGate";

export default function DashboardLayout({ children }) {
  return (
    <AuthGate>
      <div className="min-h-screen bg-white">
        <Navbar />
        {/* Clears the bar, which is shorter on a phone than on a desktop. */}
        <main className="pt-20 sm:pt-24">{children}</main>
      </div>
    </AuthGate>
  );
}
