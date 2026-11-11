import axios from "axios";

export const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
export const api = axios.create({ baseURL: API });

export const getUser = () => localStorage.getItem("evolv_user") || "QA Engineer";
export const setUser = (u) => localStorage.setItem("evolv_user", u);

export const fmtTime = (iso) =>
  iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

export const errMsg = (e) => e?.response?.data?.detail || e?.message || "Something went wrong";

export const fmtVal = (v) => (v === null || v === undefined ? "∅" : v === "" ? "''" : typeof v === "number" ? v.toLocaleString(undefined, { maximumFractionDigits: 6 }) : String(v));
