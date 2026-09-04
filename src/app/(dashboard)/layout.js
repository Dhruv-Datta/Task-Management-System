import Navbar from "@/components/Navbar";
import AuthGate from "@/components/AuthGate";

export default function DashboardLayout({ children }) {
  return (
    <AuthGate>
      <div className="min-h-screen bg-white">
        <Navbar />
        <main className="pt-24">{children}</main>
      </div>
    </AuthGate>
  );
}
