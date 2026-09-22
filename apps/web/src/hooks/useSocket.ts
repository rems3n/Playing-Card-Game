"use client";
import { useRef } from "react";
import { getWebSocket } from "@/lib/socket";
export function useSocket() {
  return useRef(getWebSocket()).current;
}
