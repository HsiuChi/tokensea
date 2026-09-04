import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { AuthBrand } from "@/components/AuthBrand"
import { AuthHero } from "@/components/AuthHero"
import { ThemeToggle } from "@/components/ThemeToggle"

export function AuthPageShell({ children, wideForm = false }: { children: ReactNode; wideForm?: boolean }) {
  const { i18n } = useTranslation()

  return (
    <div className="relative isolate flex min-h-dvh flex-col overflow-x-clip bg-[#f3f8ff] text-slate-950 dark:bg-[#050a13] dark:text-slate-100">
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_16%_10%,rgba(255,255,255,1)_0,rgba(255,255,255,0.82)_25%,rgba(225,238,255,0.72)_56%,rgba(179,211,255,0.62)_100%)] dark:hidden" />
        <div className="absolute -right-44 -top-52 h-[640px] w-[780px] rounded-full bg-blue-300/25 blur-3xl dark:hidden" />
        <div className="absolute -bottom-80 right-[-12%] h-[720px] w-[980px] rounded-[50%] border border-blue-300/40 bg-gradient-to-r from-blue-300/10 via-sky-300/12 to-indigo-400/15 dark:hidden" />

        <div className="absolute inset-0 hidden bg-[radial-gradient(circle_at_18%_12%,rgba(20,35,61,0.9)_0,rgba(7,15,29,0.96)_42%,rgba(3,8,17,1)_100%)] dark:block" />
        <div className="absolute -right-48 -top-56 hidden h-[680px] w-[820px] rounded-full bg-blue-500/10 blur-3xl dark:block" />
        <div className="absolute -bottom-80 right-[-12%] hidden h-[720px] w-[980px] rounded-[50%] border border-blue-400/10 bg-gradient-to-r from-blue-500/5 via-cyan-400/5 to-indigo-500/8 dark:block" />

        <svg className="absolute inset-0 h-full w-full text-blue-300/50 dark:text-blue-400/15" viewBox="0 0 1440 900" preserveAspectRatio="none">
          <path d="M690 900C666 626 704 350 1048 132C1192 41 1326 21 1440 36" stroke="currentColor" fill="none" />
          <circle cx="701" cy="560" r="6" fill="currentColor" />
          <circle cx="1122" cy="92" r="5" fill="currentColor" />
        </svg>
      </div>

      <header className="relative z-10 mx-auto flex w-full max-w-[1480px] items-center justify-between px-6 py-5 sm:px-8 lg:px-10">
        <AuthBrand />
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => i18n.changeLanguage(i18n.language === "en" ? "zh" : "en")}
            className="flex items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-white/55 dark:text-slate-300 dark:hover:bg-white/8"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
              <path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            {i18n.language === "en" ? "中文" : "EN"}
          </button>
          <ThemeToggle />
        </div>
      </header>

      <main className={`relative z-10 mx-auto grid w-full max-w-[1400px] flex-1 grid-cols-1 items-center gap-12 px-6 py-4 sm:px-8 lg:px-10 lg:py-6 xl:gap-16 ${wideForm ? "xl:grid-cols-[minmax(0,1fr)_480px]" : "xl:grid-cols-[minmax(0,1fr)_440px]"}`}>
        <AuthHero />
        {children}
      </main>

      <footer className="relative z-10 px-6 pb-5 pt-3 text-center text-xs font-semibold text-slate-400 dark:text-slate-600">
        © 2026 TokenSea
      </footer>
    </div>
  )
}
