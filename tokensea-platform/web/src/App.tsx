import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AuthProvider, useAuth } from "@/hooks/useAuth"
import { ThemeProvider } from "@/hooks/useTheme"
import { AppLayout } from "@/components/AppLayout"
import { LoginPage } from "@/pages/Login"
import { RegisterPage } from "@/pages/Register"
import { ForgotPasswordPage } from "@/pages/ForgotPassword"
import { ResetPasswordPage } from "@/pages/ResetPassword"
import { VerifyEmailPage } from "@/pages/VerifyEmail"
import { DashboardPage } from "@/pages/Dashboard"
import { KeysPage } from "@/pages/Keys"
import { UsagePage } from "@/pages/Usage"
import { SettingsPage } from "@/pages/Settings"
import { TopupPage } from "@/pages/Topup"
import { ChatPage } from "@/pages/Chat"
import { VideoWorkbenchPage } from '@/pages/VideoWorkbench'
import { LogsPage } from "@/pages/Logs"
import { MarketplacePage } from "@/pages/Marketplace"
import { ChannelStatusPage } from "@/pages/ChannelStatus"
import { DeployPage } from "@/pages/Deploy"
import { AdminDashboard } from "@/pages/admin/Dashboard"
import { AdminUsers } from "@/pages/admin/Users"
import { AdminKeys } from "@/pages/admin/Keys"
import { AdminPlans } from "@/pages/admin/Plans"
import { AdminChannels } from "@/pages/admin/Channels"
import { AdminModels } from "@/pages/admin/Models"
import { AdminRedemptions } from "@/pages/admin/Redemptions"
import { AdminAnnouncements } from "@/pages/admin/Announcements"
import { AdminLogs } from "@/pages/admin/Logs"
import { AdminSettings } from "@/pages/admin/Settings"
import { NotFoundPage } from "@/pages/NotFound"

const queryClient = new QueryClient()

function ProtectedRoute({ children, admin }: { children: React.ReactNode; admin?: boolean }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="flex h-screen items-center justify-center"><div className="animate-pulse text-muted-foreground">Loading...</div></div>
  if (!user) return <Navigate to="/login" replace />
  if (user.email && !user.emailVerified) return <Navigate to="/verify-email" replace />
  if (admin && user.role !== "admin" && user.role !== "root") return <Navigate to="/app" replace />
  return <AppLayout admin={admin}>{children}</AppLayout>
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/app" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/app" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
      <Route path="/app/keys" element={<ProtectedRoute><KeysPage /></ProtectedRoute>} />
      <Route path="/app/usage" element={<ProtectedRoute><UsagePage /></ProtectedRoute>} />
      <Route path="/app/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
      <Route path="/app/topup" element={<ProtectedRoute><TopupPage /></ProtectedRoute>} />
      <Route path="/app/marketplace" element={<ProtectedRoute><MarketplacePage /></ProtectedRoute>} />
      <Route path="/app/channels" element={<ProtectedRoute><ChannelStatusPage /></ProtectedRoute>} />
      <Route path="/app/deploy" element={<ProtectedRoute><DeployPage /></ProtectedRoute>} />
      <Route path="/app/chat" element={<ProtectedRoute><ChatPage /></ProtectedRoute>} />
      <Route path="/app/video" element={<ProtectedRoute><VideoWorkbenchPage /></ProtectedRoute>} />
      <Route path="/app/logs" element={<ProtectedRoute><LogsPage /></ProtectedRoute>} />
      <Route path="/admin" element={<ProtectedRoute admin><AdminDashboard /></ProtectedRoute>} />
      <Route path="/admin/users" element={<ProtectedRoute admin><AdminUsers /></ProtectedRoute>} />
      <Route path="/admin/keys" element={<ProtectedRoute admin><AdminKeys /></ProtectedRoute>} />
      <Route path="/admin/plans" element={<ProtectedRoute admin><AdminPlans /></ProtectedRoute>} />
      <Route path="/admin/channels" element={<ProtectedRoute admin><AdminChannels /></ProtectedRoute>} />
      <Route path="/admin/models" element={<ProtectedRoute admin><AdminModels /></ProtectedRoute>} />
      <Route path="/admin/redemptions" element={<ProtectedRoute admin><AdminRedemptions /></ProtectedRoute>} />
      <Route path="/admin/announcements" element={<ProtectedRoute admin><AdminAnnouncements /></ProtectedRoute>} />
      <Route path="/admin/logs" element={<ProtectedRoute admin><AdminLogs /></ProtectedRoute>} />
      <Route path="/admin/settings" element={<ProtectedRoute admin><AdminSettings /></ProtectedRoute>} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <BrowserRouter>
            <TooltipProvider>
              <AppRoutes />
            </TooltipProvider>
          </BrowserRouter>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
