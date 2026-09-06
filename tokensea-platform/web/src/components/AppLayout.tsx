import { useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useAuth } from "@/hooks/useAuth"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import {
  LayoutDashboard, KeyRound, Cpu, Activity, PackageCheck, ScrollText, Wallet,
  Menu, LogOut, User, Languages, ChevronDown, ChevronLeft, ChevronRight,
  Bell, BookOpen, ShieldCheck,
} from "lucide-react"
import { ThemeToggle } from "@/components/ThemeToggle"
import { LogoMark } from "@/components/LogoMark"

interface NavItem { label: string; icon: React.ElementType; path: string }

export function AppLayout({ children, admin }: { children: React.ReactNode; admin?: boolean }) {
  const { t, i18n } = useTranslation()
  const { user, logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const isAdmin = user?.role === "admin" || user?.role === "root"

  const userNav: NavItem[] = [
    { label: t("nav.dashboard"), icon: LayoutDashboard, path: "/app" },
    { label: t("nav.keys"), icon: KeyRound, path: "/app/keys" },
    { label: t("nav.marketplace"), icon: Cpu, path: "/app/marketplace" },
    { label: t("nav.channelStatus"), icon: Activity, path: "/app/channels" },
    { label: t("nav.deploy"), icon: PackageCheck, path: "/app/deploy" },
    { label: t("nav.records"), icon: ScrollText, path: "/app/logs" },
    { label: t("nav.balanceTopup"), icon: Wallet, path: "/app/topup" },
  ]

  const adminNav: NavItem[] = [
    { label: t("nav.dashboard"), icon: LayoutDashboard, path: "/admin" },
    { label: t("nav.users"), icon: User, path: "/admin/users" },
    { label: t("nav.keys"), icon: KeyRound, path: "/admin/keys" },
    { label: t("nav.plans"), icon: Wallet, path: "/admin/plans" },
    { label: t("nav.channels"), icon: Activity, path: "/admin/channels" },
    { label: t("nav.models"), icon: Cpu, path: "/admin/models" },
    { label: t("nav.redemptions"), icon: PackageCheck, path: "/admin/redemptions" },
    { label: t("nav.announcements"), icon: Bell, path: "/admin/announcements" },
    { label: t("nav.logs"), icon: ScrollText, path: "/admin/logs" },
    { label: t("nav.settings"), icon: ShieldCheck, path: "/admin/settings" },
  ]

  const navItems = admin ? adminNav : userNav
  const active = (path: string) => path === "/app" || path === "/admin" ? location.pathname === path : location.pathname.startsWith(path)

  function AccountMenu({ compact = false }: { compact?: boolean }) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button aria-label={t("nav.account")} className={cn(
            "flex w-full items-center rounded-xl border border-slate-200/80 bg-white p-2.5 text-left shadow-sm transition hover:border-blue-200 hover:bg-blue-50/50 dark:border-slate-700 dark:bg-slate-900/80 dark:hover:bg-blue-500/10",
            compact && "justify-center border-0 bg-transparent p-1 shadow-none"
          )}>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">
              {user?.username?.[0]?.toUpperCase() || "U"}
            </span>
            {!compact && <>
              <span className="ml-3 min-w-0 flex-1">
                <span className="block truncate text-sm font-bold text-slate-900 dark:text-slate-100">{user?.username || "User"}</span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">{t("nav.personalAccount")}</span>
              </span>
              <ChevronDown className="h-4 w-4 text-slate-400" />
            </>}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-56 dark:border-slate-800 dark:bg-slate-900">
          <div className="px-2 py-2">
            <p className="truncate text-sm font-bold text-slate-900 dark:text-slate-100">{user?.username}</p>
            <p className="truncate text-xs text-slate-500">{user?.email || t("nav.personalAccount")}</p>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => navigate("/app/settings")}><User className="mr-2 h-4 w-4" />{t("nav.accountSettings")}</DropdownMenuItem>
          {isAdmin && <DropdownMenuItem onClick={() => navigate(admin ? "/app" : "/admin")}><ShieldCheck className="mr-2 h-4 w-4" />{admin ? t("nav.userPanel") : t("nav.adminPanel")}</DropdownMenuItem>}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={logout} className="text-red-600 focus:text-red-600"><LogOut className="mr-2 h-4 w-4" />{t("auth.logout")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
    return <div className="flex h-full flex-col">
      <div className={cn("flex h-[72px] items-center px-6", collapsed && "justify-center px-3")}>
        <LogoMark size={collapsed ? 30 : 28} />
        {!collapsed && <span className="ml-2.5 text-[22px] font-extrabold tracking-[-0.04em]"><span className="text-[#102d52] dark:text-slate-100">Token</span><span className="text-[#1688e8]">Sea</span></span>}
      </div>
      <ScrollArea className="flex-1 px-4 py-2">
        <nav className="space-y-1.5">{navItems.map((item) => {
          const selected = active(item.path)
          return <button key={item.path} onClick={() => { navigate(item.path); onNavigate?.() }} title={collapsed ? item.label : undefined} className={cn(
            "group flex h-11 w-full items-center gap-3 rounded-xl px-4 text-sm font-semibold transition-all",
            selected ? "bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400" : "text-slate-600 hover:bg-slate-50 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-slate-100",
            collapsed && "mx-auto h-11 w-11 justify-center px-0"
          )}>
            <item.icon className={cn("h-[19px] w-[19px] shrink-0", selected ? "text-blue-600" : "text-slate-500 group-hover:text-slate-700 dark:text-slate-500")} />
            {!collapsed && <span>{item.label}</span>}
          </button>
        })}</nav>
      </ScrollArea>
      <div className="px-4 pb-5 pt-3"><AccountMenu compact={collapsed} /></div>
    </div>
  }

  return <div className="flex h-screen overflow-hidden bg-[#f8fbff] dark:bg-[#020617]">
    <aside className={cn("relative hidden flex-col border-r border-slate-200/80 bg-white transition-[width] duration-300 md:flex dark:border-slate-800/70 dark:bg-[#090f1d]", collapsed ? "w-[72px]" : "w-[236px]")}>
      <SidebarNav />
      <button onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? t("nav.expand") : t("nav.collapse")} className="absolute -right-3.5 top-7 z-10 flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 shadow-sm hover:text-slate-700 dark:border-slate-700 dark:bg-slate-900">
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
      </button>
    </aside>
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex h-[58px] shrink-0 items-center justify-between border-b border-slate-200/80 bg-white px-5 md:px-8 dark:border-slate-800/70 dark:bg-[#090f1d]">
        <div className="flex items-center md:hidden">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}><SheetTrigger asChild><Button variant="ghost" size="icon"><Menu className="h-5 w-5" /></Button></SheetTrigger><SheetContent side="left" className="w-[260px] p-0"><SidebarNav onNavigate={() => setMobileOpen(false)} /></SheetContent></Sheet>
          <LogoMark size={26} className="ml-2" /><span className="ml-2 text-lg font-extrabold text-[#102d52] dark:text-white">Token<span className="text-[#1688e8]">Sea</span></span>
        </div>
        <div className="hidden md:block" />
        <div className="flex items-center gap-1 sm:gap-2">
          <button className="hidden h-9 items-center rounded-lg px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100 sm:flex dark:text-slate-300 dark:hover:bg-white/10"><BookOpen className="mr-2 h-4 w-4" />{t("dashboard.apiDocs")}</button>
          <button aria-label={i18n.resolvedLanguage==='en'?'Switch to Chinese':'切换到英文'} onClick={() => i18n.changeLanguage(i18n.resolvedLanguage === "en" ? "zh" : "en")} className="flex h-9 items-center rounded-lg px-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10"><Languages className="mr-1.5 h-4 w-4" />{i18n.resolvedLanguage === "en" ? "English" : "简体中文"}</button>
          <ThemeToggle />
          <button className="relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10"><Bell className="h-[19px] w-[19px]" /><span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full border-2 border-white bg-red-500 dark:border-slate-900" /></button>
        </div>
      </header>
      <main className="flex-1 overflow-auto"><div className="mx-auto w-full max-w-[1600px] px-5 py-6 md:px-7 lg:px-8">{children}</div></main>
    </div>
  </div>
}
