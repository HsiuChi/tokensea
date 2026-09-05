const API_BASE = '';

async function request<T>(path: string, options?: RequestInit, raw?: boolean): Promise<T> {
  const token = localStorage.getItem("token");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string> || {}),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error?.message || `Request failed: ${res.status}`);
  }
  return raw ? data : (data.data ?? data);
}

export const api = {
  // Auth
  register: (body: { username: string; password: string; email?: string; inviteCode?: string }) =>
    request<{ user: any; token: string }>("/api/auth/register", { method: "POST", body: JSON.stringify(body) }),
  login: (body: { username: string; password: string }) =>
    request<{ user: any; token: string }>("/api/auth/login", { method: "POST", body: JSON.stringify(body) }),
  forgotPassword: (email: string) =>
    request<{ message: string }>("/api/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) }),
  resetPassword: (token: string, newPassword: string) =>
    request<{ message: string }>("/api/auth/reset-password", { method: "POST", body: JSON.stringify({ token, newPassword }) }),
  verifyEmail: (token: string) =>
    request<{ message: string }>("/api/auth/verify-email", { method: "POST", body: JSON.stringify({ token }) }),
  resendVerification: () =>
    request<{ message: string }>("/api/auth/resend-verification", { method: "POST" }),

  // User
  getSelf: () => request<any>("/api/user/self"),
  updateSelf: (body: { name?: string; email?: string }) =>
    request<any>("/api/user/self", { method: "PUT", body: JSON.stringify(body) }),
  changePassword: (oldPassword: string, newPassword: string) =>
    request<any>("/api/user/self/password", { method: "PUT", body: JSON.stringify({ oldPassword, newPassword }) }),
  deleteAccount: () =>
    request<any>("/api/user/self", { method: "DELETE" }),
  getBindings: () =>
    request<any>("/api/user/self/bindings"),
  getOrders: (page = 1) =>
    request<any>(`/api/user/self/orders?page=${page}`),

  // Tokens
  listTokens: (page = 1, pageSize = 20) =>
    request<any>(`/api/token/?page=${page}&pageSize=${pageSize}`),
  createToken: (body: { name: string; planId?: number; quota?: number; models?: string[]; expiresAt?: string }) =>
    request<{ apiKey: any; key: string }>("/api/token/", { method: "POST", body: JSON.stringify(body) }),
  updateToken: (id: string, body: any) =>
    request<any>(`/api/token/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteToken: (id: string) =>
    request<any>(`/api/token/${id}`, { method: "DELETE" }),

  // Models
  listModels: () =>
    request<{ object: string; data: any[] }>("/v1/models"),
  getMarketplaceModels: (params?: string) =>
    request<any>(`/api/public/models${params ? `?${params}` : ""}`, undefined, true),
  getModelDetail: (alias: string) =>
    request<any>(`/api/public/models/${alias}`),
  getChannelStatus: (period: "24h" | "7d" | "30d" = "7d") =>
    request<any>(`/api/public/channel-status?period=${period}`, undefined, true),

  // Plans
  listPublicPlans: () => request<any>("/api/plan/public"),
  listPlans: () => request<any>("/api/plan/"),
  createPlan: (body: any) => request<any>("/api/plan/", { method: "POST", body: JSON.stringify(body) }),
  updatePlan: (id: string, body: any) => request<any>(`/api/plan/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deletePlan: (id: string) => request<any>(`/api/plan/${id}`, { method: "DELETE" }),
  bindPlan: (userId: string, planId: string, durationDays?: number) =>
    request<any>("/api/plan/bind", { method: "POST", body: JSON.stringify({ userId, planId, durationDays }) }),

  // Channels
  listChannels: (page = 1) => request<any>(`/api/channel/?page=${page}`),
  getKsyunCatalog: () => request<any>("/api/channel/ksyun/catalog"),
  bootstrapKsyun: (body: any) => request<any>("/api/channel/ksyun/bootstrap", { method: "POST", body: JSON.stringify(body) }),
  getChannel: (id: string) => request<any>(`/api/channel/${id}`),
  createChannel: (body: any) => request<any>("/api/channel/", { method: "POST", body: JSON.stringify(body) }),
  updateChannel: (id: string, body: any) => request<any>(`/api/channel/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteChannel: (id: string) => request<any>(`/api/channel/${id}`, { method: "DELETE" }),
  addNode: (channelId: string, body: any) => request<any>(`/api/channel/${channelId}/nodes`, { method: "POST", body: JSON.stringify(body) }),
  deleteNode: (nodeId: string) => request<any>(`/api/channel/nodes/${nodeId}`, { method: "DELETE" }),
  healthCheckNode: (nodeId: string) => request<any>(`/api/channel/nodes/${nodeId}/health`, { method: "POST" }),
  getOAuthStatus: (nodeId: string) => request<any>(`/api/channel/nodes/${nodeId}/oauth`),
  syncChannelModels: (id: string) => request<any>(`/api/channel/${id}/sync-models`, { method: "POST" }),
  testChannel: (id: string, model?: string) => request<any>(`/api/channel/${id}/test`, { method: "POST", body: JSON.stringify(model ? { model } : {}) }),
  testNode: (channelId: string, nodeId: string, model?: string) => request<any>(`/api/channel/${channelId}/nodes/${nodeId}/test`, { method: "POST", body: JSON.stringify(model ? { model } : {}) }),

  // Webhooks
  listWebhooks: () => request<any>("/api/webhook/"),
  listWebhookEvents: () => request<any>("/api/webhook/events"),
  createWebhook: (body: any) => request<any>("/api/webhook/", { method: "POST", body: JSON.stringify(body) }),
  updateWebhook: (id: string, body: any) => request<any>(`/api/webhook/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteWebhook: (id: string) => request<any>(`/api/webhook/${id}`, { method: "DELETE" }),
  testWebhook: (id: string) => request<any>(`/api/webhook/${id}/test`, { method: "POST" }),

  // Key groups
  listKeyGroups: (page = 1) => request<any>(`/api/keygroup/?page=${page}`),
  createKeyGroup: (body: any) => request<any>("/api/keygroup/", { method: "POST", body: JSON.stringify(body) }),
  updateKeyGroup: (id: string, body: any) => request<any>(`/api/keygroup/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteKeyGroup: (id: string) => request<any>(`/api/keygroup/${id}`, { method: "DELETE" }),

  // Redemptions
  listRedemptions: (page = 1) => request<any>(`/api/redemption/?page=${page}`),
  createRedemption: (body: any) => request<any>("/api/redemption/", { method: "POST", body: JSON.stringify(body) }),
  batchCreateRedemptions: (body: any) => request<any>("/api/redemption/batch", { method: "POST", body: JSON.stringify(body) }),
  deleteRedemption: (id: string) => request<any>(`/api/redemption/${id}`, { method: "DELETE" }),
  redeemCode: (code: string) => request<any>("/api/redemption/redeem", { method: "POST", body: JSON.stringify({ code }) }),

  // Logs
  getSelfLogs: (params: { page?: number; status?: string; requestedModel?: string; startDate?: string; endDate?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.page) qs.set("page", String(params.page));
    if (params.status) qs.set("status", params.status);
    if (params.requestedModel) qs.set("requestedModel", params.requestedModel);
    if (params.startDate) qs.set("startDate", params.startDate);
    if (params.endDate) qs.set("endDate", params.endDate);
    return request<any>(`/api/log/self?${qs.toString()}`);
  },
  getSelfStats: (params?: { period?: string; startDate?: string; endDate?: string }) => {
    const qs = new URLSearchParams();
    if (params?.period) qs.set("period", params.period);
    if (params?.startDate) qs.set("startDate", params.startDate);
    if (params?.endDate) qs.set("endDate", params.endDate);
    const s = qs.toString();
    return request<any>(`/api/log/self/stats${s ? `?${s}` : ""}`);
  },
  getLogs: (params: { page?: number; status?: string; requestedModel?: string; startDate?: string; endDate?: string; userId?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.page) qs.set("page", String(params.page));
    if (params.status) qs.set("status", params.status);
    if (params.requestedModel) qs.set("requestedModel", params.requestedModel);
    if (params.startDate) qs.set("startDate", params.startDate);
    if (params.endDate) qs.set("endDate", params.endDate);
    if (params.userId) qs.set("userId", params.userId);
    return request<any>(`/api/log/?${qs.toString()}`);
  },
  getGlobalStats: () => request<any>("/api/log/stats"),
  getAuditLogs: (page = 1) => request<any>(`/api/log/audit?page=${page}`),

  // Admin Users
  listUsers: (page = 1, search?: string) =>
    request<any>(`/api/admin/users?page=${page}${search ? `&search=${search}` : ""}`),
  getUser: (id: string) => request<any>(`/api/admin/users/${id}`),
  createUser: (body: any) => request<any>("/api/admin/users", { method: "POST", body: JSON.stringify(body) }),
  updateUser: (id: string, body: any) => request<any>(`/api/admin/users/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteUser: (id: string) => request<any>(`/api/admin/users/${id}`, { method: "DELETE" }),
  resetUserPassword: (id: string, password: string) =>
    request<any>(`/api/admin/users/${id}/reset-password`, { method: "POST", body: JSON.stringify({ password }) }),

  // Admin Models
  listAdminModels: () => request<any>("/api/admin/models"),
  createModel: (body: any) => request<any>("/api/admin/models", { method: "POST", body: JSON.stringify(body) }),
  updateModel: (id: string, body: any) => request<any>(`/api/admin/models/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteModel: (id: string) => request<any>(`/api/admin/models/${id}`, { method: "DELETE" }),
  createModelRoute: (aliasId: string, body: any) => request<any>(`/api/admin/models/${aliasId}/routes`, { method: "POST", body: JSON.stringify(body) }),
  deleteModelRoute: (id: string) => request<any>(`/api/admin/models/routes/${id}`, { method: "DELETE" }),

  // Admin Options
  getOptions: () => request<any>("/api/admin/options"),
  updateOptions: (body: Record<string, string>) => request<any>("/api/admin/options", { method: "PUT", body: JSON.stringify(body) }),

  // Admin Announcements
  listAnnouncements: (page = 1) =>
    request<any>(`/api/admin/announcements?page=${page}`),
  createAnnouncement: (body: { title: string; content: string; type?: string; pinned?: boolean }) =>
    request<any>("/api/admin/announcements", { method: "POST", body: JSON.stringify(body) }),
  updateAnnouncement: (id: string, body: any) =>
    request<any>(`/api/admin/announcements/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteAnnouncement: (id: string) =>
    request<any>(`/api/admin/announcements/${id}`, { method: "DELETE" }),

  // Topup
  createTopupOrder: (paymentMethod: string, amount: number) =>
    request<any>("/api/topup/order", { method: "POST", body: JSON.stringify({ paymentMethod, amount }) }),
  getTopupOrders: (page = 1) =>
    request<any>(`/api/topup/orders?page=${page}`),

  // Public
  getPublicAnnouncements: () => request<any>("/api/public/announcements"),
  getPublicModels: () => request<any>("/api/public/models"),
};
