import { cookies } from "next/headers";
import { getAppSession } from "./app-auth";

export type Viewer =
  | {
      access: "owner";
      email: string;
      displayName: string;
      employeeId: null;
      businessId: string;
      businessName: string;
    }
  | {
      access: "employee";
      email: string;
      displayName: string;
      employeeId: number;
      businessId: string;
      businessName: string;
    }
  | {
      access: "pending";
      email: null;
      displayName: string;
      employeeId: null;
      businessId: null;
      businessName: null;
    };

export async function getViewer(): Promise<Viewer> {
  const cookieStore = await cookies();
  if (cookieStore.get("hourmark_demo")?.value === "1") {
    return { access: "owner", email: "demo@example.invalid", displayName: "Demo Owner", employeeId: null, businessId: "__coreshift_demo__", businessName: "CoreShift Demo" };
  }
  const appSession = await getAppSession(
    cookieStore.get("hourmark_session")?.value,
  );
  if (
    appSession?.access === "owner" &&
    (appSession.ownerName || appSession.name) &&
    appSession.businessId &&
    appSession.businessName
  ) {
    return {
      access: "owner",
      // A second owner may be an employee whose role was promoted to Owner.
      // Keep that person's identity in the UI while granting owner access.
      email: appSession.employeeId ? (appSession.email ?? "") : (appSession.ownerEmail ?? ""),
      displayName: appSession.employeeId ? (appSession.name ?? appSession.ownerName ?? "Owner") : appSession.ownerName,
      employeeId: null,
      businessId: appSession.businessId,
      businessName: appSession.businessName,
    };
  }
  if (
    appSession?.access === "employee" &&
    appSession.employeeId &&
    appSession.name &&
    appSession.businessId &&
    appSession.businessName
  ) {
    return {
      access: "employee",
      email: appSession.email ?? "",
      displayName: appSession.name,
      employeeId: appSession.employeeId,
      businessId: appSession.businessId,
      businessName: appSession.businessName,
    };
  }

  return {
    access: "pending",
    email: null,
    displayName: "Guest",
    employeeId: null,
    businessId: null,
    businessName: null,
  };
}
