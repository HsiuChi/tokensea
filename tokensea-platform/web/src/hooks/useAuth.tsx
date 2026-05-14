import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react"
import api from "@/lib/api"

interface User {
  id: string
  username: string
  email?: string
  name?: string
  role: string
  status: string
  quota: string
  usedQuota: string
  inviteCode: string
  emailVerified?: boolean
}

interface AuthContextType {
  user: User | null
  loading: boolean
  login: (username: string, password: string) => Promise<User>
  register: (username: string, password: string, email: string, code: string) => Promise<User>
  sendRegisterCode: (email: string) => Promise<void>
  logout: () => void
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  const refreshUser = useCallback(async () => {
    try {
      const res = await api.get("/api/user/self")
      const userData = res.data ?? res
      setUser(userData)
    } catch {
      localStorage.removeItem("token")
      setUser(null)
    }
  }, [])

  useEffect(() => {
    const token = localStorage.getItem("token")
    if (token) {
      refreshUser().finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [refreshUser])

  const login = async (username: string, password: string) => {
    const res = await api.post("/api/auth/login", { username, password })
    const payload = res.data ?? res
    if (!payload.token || !payload.user) {
      throw new Error("Invalid login response")
    }
    localStorage.setItem("token", payload.token)
    setUser(payload.user)
    return payload.user as User
  }

  const sendRegisterCode = async (email: string) => {
    await api.post("/api/auth/send-register-code", { email })
  }

  const register = async (username: string, password: string, email: string, code: string) => {
    const res = await api.post("/api/auth/register", { username, password, email, code })
    const payload = res.data ?? res
    if (!payload.token || !payload.user) {
      throw new Error("Invalid register response")
    }
    localStorage.setItem("token", payload.token)
    setUser(payload.user)
    return payload.user as User
  }

  const logout = () => {
    localStorage.removeItem("token")
    setUser(null)
    window.location.href = "/login"
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, sendRegisterCode, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
