import { Load } from "./types.js";

export const MOCK_LOADS: Load[] = [
  {
    id: "LOAD-001",
    origin: "Chicago, IL",
    destination: "Nashville, TN",
    carrier_name: "Swift Transport",
  },
  {
    id: "LOAD-002",
    origin: "Los Angeles, CA",
    destination: "Phoenix, AZ",
    carrier_name: "Sun State Freight",
  },
  {
    id: "LOAD-003",
    origin: "Dallas, TX",
    destination: "Houston, TX",
    carrier_name: "Lone Star Logistics",
  },
  {
    id: "LOAD-004",
    origin: "Seattle, WA",
    destination: "Portland, OR",
    carrier_name: "Pacific Freight Co.",
  },
  {
    // Designed to trigger the escalation path via breakdown
    id: "LOAD-005",
    origin: "Atlanta, GA",
    destination: "Charlotte, NC",
    carrier_name: "Southeastern Trucking",
  },
];
