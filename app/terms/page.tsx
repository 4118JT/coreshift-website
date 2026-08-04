import Link from "next/link";

export const dynamic = "force-static";

export default function TermsPage() {
  return <main className="legal-page"><article className="legal-card">
    <Link className="legal-back" href="/login">← Back to sign in</Link>
    <p className="eyebrow">CoreShift</p><h1>Terms &amp; Conditions</h1><p className="legal-updated">Last updated: July 31, 2026</p>
    <p>These Terms govern use of the CoreShift workforce-management workspace. By creating a workspace, joining a company, or using the service, you agree to these Terms. A company should have its legal adviser review them for its particular needs.</p>
    <h2>1. What CoreShift provides</h2><p>CoreShift helps teams organize schedules, availability, time clocks, timesheets, requests, messages, reports, documents, and payroll estimates. CoreShift is not a bank, payment processor, payroll tax service, employer of record, or employment-law adviser. It does not move money or guarantee wages, taxes, benefits, or compliance.</p>
    <h2>2. Company responsibility</h2><p>The company that creates and operates a workspace is responsible for the information and activity in it, including employee names, contact details, schedules, time records, pay rates, documents, notes, messages, permissions, and exports. The company must have a lawful basis and any required consent or notice for collecting and using that information.</p>
    <h2>3. Accounts, invites, and permissions</h2><p>Owners and managers must invite only authorized people, keep company invite codes private, choose appropriate role permissions, and remove access promptly when someone leaves. Employees must provide accurate information, keep credentials private, and report suspected unauthorized access. Phone verification is not required to join a company; each user is responsible for protecting the email and password used for their account.</p>
    <h2>4. Demo mode</h2><p>The demo is for evaluation only. It uses sample data, does not require an account, and changes made in demo mode are not saved or sent to a company. Do not enter real personal, payroll, or confidential information into the demo.</p>
    <h2>5. Payroll, records, and compliance</h2><p>Companies must review schedules, clock entries, edits, approvals, pay rates, overtime, breaks, leave, reimbursements, and payment status before relying on them. The company remains responsible for calculating and paying wages and taxes, maintaining required records, and complying with employment, privacy, accessibility, and retention laws.</p>
    <h2>6. Acceptable use</h2><p>Do not use CoreShift unlawfully, upload information you are not authorized to handle, impersonate another person, misuse another workspace, attempt to bypass permissions, or disrupt the service. Companies are responsible for activity performed through their workspace.</p>
    <h2>7. Availability and security</h2><p>We use reasonable technical and organizational safeguards, but no online service is completely secure or uninterrupted. CoreShift is provided as available, and records should be backed up or exported when they are important to you.</p>
    <h2>8. Changes, suspension, and termination</h2><p>We may update these Terms as the product or law changes and will update the date above. We may suspend access when necessary to protect users, the service, or comply with law. A company may stop using its workspace at any time; it remains responsible for its records and obligations after termination.</p>
    <h2>9. Disclaimer and limitation</h2><p>To the extent permitted by law, CoreShift is provided without warranties of uninterrupted operation, error-free records, or fitness for a particular purpose. CoreShift is not responsible for employment decisions, payroll outcomes, legal compliance, or losses caused by inaccurate information, unauthorized access, or a company’s failure to review its data.</p>
    <h2>10. Contact</h2><p>Questions about a company’s workspace, employee data, or employment practices should be directed to that company. Questions about these Terms can be sent through the support contact provided with your CoreShift account.</p>
    <p className="legal-note">This page is general information, not legal advice. Your company remains responsible for adopting terms and notices appropriate to its business.</p>
    <p className="legal-links"><Link href="/privacy">Privacy Policy →</Link></p>
  </article></main>;
}
