import Link from "next/link";

export const dynamic = "force-static";

export default function PrivacyPage() {
  return <main className="legal-page"><article className="legal-card">
    <Link className="legal-back" href="/login">← Back to sign in</Link>
    <p className="eyebrow">CoreShift</p><h1>Privacy Policy</h1><p className="legal-updated">Last updated: July 31, 2026</p>
    <p>This Privacy Policy explains how CoreShift handles information in the service. The company that owns a workspace controls the employee and business information entered there and is responsible for its instructions, notices, and legal obligations.</p>
    <h2>1. Information in a company workspace</h2><p>A workspace may contain names, email addresses, phone numbers, profile photos, schedules, availability, time punches, timesheets, pay rates, payroll estimates, requests, messages, documents, and audit or permission information. The company decides what to collect and who can see it through role permissions.</p>
    <h2>2. Account information</h2><p>We use account information such as email, password credentials, company membership, role, and session information to sign users in, keep the service secure, and provide the requested features. Phone verification is not required for employee joining in the current product.</p>
    <h2>3. How information is used</h2><p>Information is used to provide scheduling, time tracking, messaging, reporting, document, payroll-estimate, authentication, support, and security features; to save and display changes requested by authorized users; and to prevent abuse or unauthorized access.</p>
    <h2>4. Demo mode</h2><p>Demo mode uses synthetic sample data. Demo changes are not saved to a company workspace or sent to other people. Please do not enter real personal or confidential information into the demo.</p>
    <h2>5. Sharing and access</h2><p>Workspace information is shown to people authorized by the company’s roles and permissions. Do not upload or share information unless you have authority to do so. We do not sell workspace information. Information may be processed by hosting, database, security, and support providers needed to operate the service.</p>
    <h2>6. Security and retention</h2><p>CoreShift uses reasonable safeguards such as encrypted connections, protected sessions, and access controls. No system can promise absolute security. The company controls retention and should export or delete records according to its policies and legal requirements.</p>
    <h2>7. Your choices</h2><p>Users can ask their company to correct or remove workspace information, change permissions, or close access. Owners can use the product’s available export and account controls. We may retain limited security or transaction records when required to protect the service or comply with law.</p>
    <h2>8. Children and sensitive information</h2><p>CoreShift is intended for workplace use, not for children. Companies should avoid entering unnecessary sensitive information and must ensure any information they collect is appropriate and lawful.</p>
    <h2>9. Updates and contact</h2><p>We may update this Policy as the service changes. The date above shows the latest version. Questions about employee or company data should first go to the workspace owner; questions about this Policy can be sent through the support contact provided with your CoreShift account.</p>
    <p className="legal-note">This page is general information, not legal advice. Companies should review their own privacy notices and agreements.</p>
    <p className="legal-links"><Link href="/terms">Terms &amp; Conditions →</Link></p>
  </article></main>;
}
