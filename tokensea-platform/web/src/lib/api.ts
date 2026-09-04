import axios from "axios"

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "",
  timeout: 15000,
  headers: { "Content-Type": "application/json" },
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token")
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("token")
      // Don't hard redirect — let React Router handle it
      // Only redirect if not already on a public page
      if (!window.location.pathname.match(/^\/(login|register|forgot-password|reset-password)/)) {
        window.location.href = "/login"
      }
      return Promise.reject(error)
    }
    const err = error.response?.data?.error
    const message = err?.message || error.message || "Request failed"
    return Promise.reject(new Error(message))
  }
)

export default api
