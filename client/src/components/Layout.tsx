import { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const isChatRoute = location.pathname.startsWith("/ai-chat");

  return (
    <div className="payment-gateway page-shell">
      {!isChatRoute && (
        <header className="navbar-pay sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
            <div className="flex items-center justify-between">
              <Link to="/" className="inline-flex items-center gap-3">
                <span className="brand-mark" aria-hidden="true">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none">
                    <path
                      d="M4 7h16M7 12h10M10 17h4"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
                <span>
                  <span className="brand-text text-xl sm:text-2xl font-extrabold">
                    Tjenesteguide
                  </span>
                  <span className="block text-xs font-medium text-[var(--color-text-subtle)]">
                    Admin
                  </span>
                </span>
              </Link>
              <div className="flex items-center gap-2">
                <Link to="/ai-chat" className="btn-secondary">
                  AI-chat
                </Link>
                <Link to="/tjenester/ny" className="btn-primary">
                  Ny tjeneste
                </Link>
              </div>
            </div>
          </div>
        </header>
      )}
      <main
        className={`mx-auto ${
          isChatRoute
            ? "w-full max-w-none px-0 py-0"
            : "max-w-7xl px-4 py-7 sm:px-6 sm:py-8 lg:px-8"
        }`}
      >
        {children}
      </main>
    </div>
  );
}

