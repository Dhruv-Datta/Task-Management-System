import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/AuthContext";

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-plus-jakarta",
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata = {
  title: "Tasks",
  description: "Personal task management",
  /*
    Added to an iPhone's Home Screen, this runs as a standalone app rather than
    as a page in Safari. `capable` is what asks for that; the manifest
    (app/manifest.js) is what says the app is the WHOLE origin, which is what
    stops Inbox and Tasks opening in Safari's in-app browser with a close button
    and a domain name along the top.

    The status bar stays `default` — dark text on the app's own white — rather
    than black-translucent, which would run the page up underneath the clock and
    put the status bar on top of the app bar.
  */
  appleWebApp: {
    capable: true,
    title: "Tasks",
    statusBarStyle: "default",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#10b981",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={`${plusJakarta.variable} font-[family-name:var(--font-plus-jakarta)] antialiased`}>
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
