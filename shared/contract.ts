export type ContractStatus = "draft" | "sent" | "signed" | "voided";

export type ContractFields = {
  projectName: string;
  websiteType: string;
  pages: string;
  features: string;
  totalCost: number;
  depositPercent: number;
  paymentMethod: string;
  startDate: string;
  deliveryWeeks: string;
  revisionRounds: number;
  extraRevisionCost: number;
  contentDueDate: string;
  domainIncluded: boolean;
  domainName: string;
  hostingIncluded: boolean;
  hostingPlatform: string;
  hostingCost: number;
  maintenanceFee: number;
  notes: string;
};

// Max lengths for the free-text agreement fields. Shared so the form enforces the same limits
// the server validates, instead of only failing on save.
export const contractFieldLimits = {
  projectName: 180,
  websiteType: 120,
  pages: 1000,
  features: 3000,
  paymentMethod: 120,
  startDate: 120,
  deliveryWeeks: 80,
  contentDueDate: 120,
  domainName: 180,
  hostingPlatform: 120,
  notes: 5000,
} as const;

export const defaultContractFields: ContractFields = {
  projectName: "",
  websiteType: "Business website",
  pages: "Home, About, Services, Projects, Contact",
  features: "Contact form",
  totalCost: 0,
  depositPercent: 50,
  paymentMethod: "M-Pesa",
  startDate: "",
  deliveryWeeks: "2",
  revisionRounds: 2,
  extraRevisionCost: 0,
  contentDueDate: "",
  domainIncluded: false,
  domainName: "",
  hostingIncluded: false,
  hostingPlatform: "",
  hostingCost: 0,
  maintenanceFee: 0,
  notes: "",
};
