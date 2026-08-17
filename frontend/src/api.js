import axios from "axios";

export const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const client = axios.create({ baseURL: API, withCredentials: true });

let refreshPromise = null;

client.interceptors.response.use(
  (response) => response,
  async (error) => {
    const { config, response } = error;
    const isAuthRoute = config?.url?.includes("/auth/login") || config?.url?.includes("/auth/register") || config?.url?.includes("/auth/refresh");
    if (response?.status === 401 && !config._retried && !isAuthRoute) {
      config._retried = true;
      try {
        // Coalesce concurrent 401s into a single refresh call.
        refreshPromise = refreshPromise || client.post("/auth/refresh").finally(() => { refreshPromise = null; });
        await refreshPromise;
        return client(config);
      } catch (refreshError) {
        return Promise.reject(error);
      }
    }
    return Promise.reject(error);
  }
);

export function apiError(error) {
  const detail = error?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((item) => item?.msg || "Please check your details").join(" ");
  return "Something went wrong. Please try again.";
}

export default client;
