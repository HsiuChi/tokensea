import { useTheme } from "@/hooks/useTheme"
import { Sun, Moon } from "lucide-react"

export function ThemeToggle() {
  const { resolved, setTheme, theme } = useTheme()

  const toggle = () => {
    if (theme === "auto") {
      setTheme(resolved === "dark" ? "light" : "dark")
    } else {
      setTheme(theme === "dark" ? "light" : "dark")
    }
  }

  return (
    <button
      onClick={toggle}
      className="relative inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/10"
      aria-label="Toggle theme"
    >
      <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
    </button>
  )
}
