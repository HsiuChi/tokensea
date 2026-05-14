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
  LayoutDashboard, Key, BarChart3, Settings, CreditCard, MessageSquare, Wallet,
  Shield, Users, Radio, Cpu, Ticket, FileText, ScrollText, Sparkles,
  Menu, LogOut, User, Languages, ChevronDown, ChevronLeft, ChevronRight, Bell,
} from "lucide-react"
import { ThemeToggle } from "@/components/ThemeToggle"

interface NavItem {
  label: string
  icon: React.ElementType
  path: string
}

export function AppLayout({ children, admin }: { children: React.ReactNode; admin?: boolean }) {
  const { t } = useTranslation()
  const { user, logout } = useAuth()
  const { i18n } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  const userNav: NavItem[] = [
    { label: t("nav.dashboard"), icon: LayoutDashboard, path: "/app" },
    { label: t("nav.marketplace"), icon: Cpu, path: "/app/marketplace" },
    { label: t("nav.keys"), icon: Key, path: "/app/keys" },
    { label: t("nav.chat"), icon: Sparkles, path: "/app/chat" },
    { label: t("nav.logs"), icon: ScrollText, path: "/app/logs" },
    { label: t("nav.usage"), icon: BarChart3, path: "/app/usage" },
    { label: t("nav.topup"), icon: Wallet, path: "/app/topup" },
    { label: t("nav.settings"), icon: Settings, path: "/app/settings" },
  ]

  const adminNav: NavItem[] = [
    { label: t("nav.dashboard"), icon: LayoutDashboard, path: "/admin" },
    { label: t("nav.users"), icon: Users, path: "/admin/users" },
    { label: t("nav.keys"), icon: Key, path: "/admin/keys" },
    { label: t("nav.plans"), icon: CreditCard, path: "/admin/plans" },
    { label: t("nav.channels"), icon: Radio, path: "/admin/channels" },
    { label: t("nav.models"), icon: Cpu, path: "/admin/models" },
    { label: t("nav.redemptions"), icon: Ticket, path: "/admin/redemptions" },
    { label: t("nav.announcements"), icon: MessageSquare, path: "/admin/announcements" },
    { label: t("nav.logs"), icon: FileText, path: "/admin/logs" },
    { label: t("nav.settings"), icon: Settings, path: "/admin/settings" },
  ]

  const navItems = admin ? adminNav : userNav
  const switchLabel = admin ? t("nav.userPanel") : t("nav.adminPanel")
  const switchPath = admin ? "/app" : "/admin"
  const isAdmin = user?.role === "admin" || user?.role === "root"

  function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
    return (
      <div className="flex h-full flex-col">
        {/* Logo */}
        <div className={cn("flex items-center px-5 py-7", collapsed && "justify-center px-4")}>
          <div className="flex items-center" style={{ gap: 0 }}>
            <img
              src="/shared/logo.png"
              alt="TokenSea"
              style={{
                height: collapsed ? 40 : 80,
                width: 'auto',
                objectFit: 'contain',
                marginRight: collapsed ? -6 : -13,
              }}
            />
            {!collapsed && (
              <span style={{ fontFamily: 'Montserrat, Inter, sans-serif', fontWeight: 700, fontSize: 32, letterSpacing: '-0.04em', lineHeight: 1 }}>
                <span className="text-[#0f2b50] dark:text-slate-100">Token</span><span style={{ color: '#1688e8' }}>sea</span>
              </span>
            )}
          </div>
        </div>

        {/* Nav Items */}
        <ScrollArea className="flex-1 px-4 py-2">
          <div className="space-y-1.5">
            {navItems.map((item) => {
              const active = location.pathname === item.path
              return (
                <button
                  key={item.path}
                  onClick={() => { navigate(item.path); onNavigate?.() }}
                  className={cn(
                    "group flex h-11 w-full items-center gap-4 rounded-2xl px-5 text-[15px] font-medium transition-all",
                    active
                      ? "bg-blue-50 text-blue-600 shadow-[0_10px_30px_rgba(37,99,235,0.08)] dark:bg-blue-500/10 dark:text-blue-400 dark:shadow-none"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-slate-100",
                    collapsed && "justify-center px-3 h-11 w-11 mx-auto"
                  )}
                >
                  <item.icon className={cn("h-5 w-5 shrink-0", active ? "text-blue-500 dark:text-blue-400" : "text-slate-500 group-hover:text-slate-700 dark:text-slate-500 dark:group-hover:text-slate-300")} />
                  {!collapsed && <span>{item.label}</span>}
                </button>
              )
            })}
          </div>
        </ScrollArea>

        {/* Bottom: only admin switch */}
        <div className="border-t border-slate-100 pt-4 px-4 pb-4 dark:border-slate-800/60">
          {isAdmin && (
            <button
              onClick={() => { navigate(switchPath); onNavigate?.() }}
              className={cn(
                "flex h-11 w-full items-center gap-4 rounded-2xl px-5 text-[15px] font-medium text-slate-600 hover:bg-slate-50 transition-all dark:text-slate-400 dark:hover:bg-white/5",
                collapsed && "justify-center px-3 h-11 w-11 mx-auto"
              )}
            >
              <Shield className="h-5 w-5 shrink-0 text-slate-500 dark:text-slate-500" />
              {!collapsed && <span>{switchLabel}</span>}
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#fbfdff] dark:bg-[#020617]">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden md:flex flex-col border-r border-slate-200/80 bg-white/85 backdrop-blur-xl transition-all duration-300 dark:border-slate-800/60 dark:bg-[#0a0f1d]/85",
          collapsed ? "w-[72px]" : "w-[300px]"
        )}
      >
        <SidebarNav />
        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute top-7 z-10 hidden md:flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 shadow-sm hover:text-slate-700 transition-colors dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-500 dark:hover:text-slate-300"
          style={{ left: collapsed ? "56px" : "296px" }}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </aside>

      {/* Right side */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top header bar */}
        <header className="flex h-16 items-center justify-between border-b border-slate-200/80 bg-white/85 backdrop-blur-xl px-8 dark:border-slate-800/60 dark:bg-[#0a0f1d]/85">
          {/* Mobile menu */}
          <div className="flex items-center gap-3 md:hidden">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="dark:text-slate-300"><Menu className="h-5 w-5" /></Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[280px] p-0 bg-white/95 backdrop-blur-xl dark:bg-[#0a0f1d]/95">
                <SidebarNav onNavigate={() => setMobileOpen(false)} />
              </SheetContent>
            </Sheet>
            <div className="flex items-center" style={{ gap: 0 }}>
              <img src="/shared/logo.png" alt="TokenSea" style={{ height: 36, width: 'auto', objectFit: 'contain', marginRight: -6 }} />
              <span style={{ fontFamily: 'Montserrat, Inter, sans-serif', fontWeight: 700, fontSize: 18, letterSpacing: '-0.04em', lineHeight: 1 }}>
                <span className="text-[#0f2b50] dark:text-slate-100">Token</span><span style={{ color: '#1688e8' }}>sea</span>
              </span>
            </div>
          </div>
          <div className="hidden md:block" />

          {/* Right actions */}
          <div className="flex items-center gap-2">
            {/* Docs link */}
            <button className="hidden sm:inline-flex h-10 items-center justify-center rounded-full px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10">
              <MessageSquare className="mr-2 h-5 w-5" />
              {t("dashboard.apiDocs")}
            </button>

            {/* Language toggle */}
            <button
              onClick={() => i18n.changeLanguage(i18n.language === "en" ? "zh" : "en")}
              className="inline-flex h-10 items-center justify-center rounded-full px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10"
            >
              <Languages className="mr-1.5 h-4 w-4" />
              {i18n.language === "en" ? "中" : "EN"}
            </button>

            {/* Theme toggle */}
            <ThemeToggle />

            {/* Notification bell */}
            <button className="relative flex h-10 w-10 items-center justify-center rounded-full text-slate-700 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10">
              <Bell className="h-5 w-5" />
              <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full border-2 border-white bg-red-500 dark:border-[#0a0f1d]" />
            </button>

            {/* User dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex h-11 items-center gap-2 rounded-full px-1.5 transition hover:bg-slate-100 dark:hover:bg-white/10">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-50 text-sm font-bold text-blue-600 dark:bg-blue-500/10 dark:text-blue-400">
                    {user?.username?.[0]?.toUpperCase() || "U"}
                  </span>
                  <ChevronDown className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48 dark:bg-[#0f172a] dark:border-slate-800">
                <div className="px-2 py-1.5">
                  <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{user?.username}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{user?.email}</p>
                </div>
                <DropdownMenuSeparator className="dark:bg-slate-800" />
                <DropdownMenuItem onClick={() => navigate("/app/settings")} className="dark:text-slate-300 dark:focus:bg-white/5 dark:focus:text-slate-100">
                  <User className="mr-2 h-4 w-4" />
                  {t("nav.settings")}
                </DropdownMenuItem>
                <DropdownMenuSeparator className="dark:bg-slate-800" />
                <DropdownMenuItem onClick={logout} className="text-destructive dark:focus:bg-white/5">
                  <LogOut className="mr-2 h-4 w-4" />
                  {t("auth.logout")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Main content */}
        <main className="flex-1 overflow-auto">
          <div className="h-full px-8 py-6 lg:px-12">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
