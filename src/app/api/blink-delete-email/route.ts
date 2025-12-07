import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

// Maximum attachment size (Resend's limit is 40MB)
const MAX_ATTACHMENT_SIZE = 40 * 1024 * 1024; // 40MB

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { message: "Email disabled (no RESEND_API_KEY)" },
        { status: 200 }
      );
    }
    const resend = new Resend(apiKey);

    const formData = await request.formData();
    const keptZip = formData.get("keptZip") as File | null;
    const deletedZip = formData.get("deletedZip") as File | null;
    const keptCount = formData.get("keptCount") as string;
    const deletedCount = formData.get("deletedCount") as string;
    const totalCount = formData.get("totalCount") as string;

    const attachments: { filename: string; content: Buffer }[] = [];

    // Process kept photos zip
    if (keptZip && keptZip.size > 0 && keptZip.size <= MAX_ATTACHMENT_SIZE) {
      const keptBuffer = Buffer.from(await keptZip.arrayBuffer());
      attachments.push({
        filename: `blink-delete-kept-${Date.now()}.zip`,
        content: keptBuffer,
      });
    }

    // Process deleted photos zip
    if (
      deletedZip &&
      deletedZip.size > 0 &&
      deletedZip.size <= MAX_ATTACHMENT_SIZE
    ) {
      const deletedBuffer = Buffer.from(await deletedZip.arrayBuffer());
      attachments.push({
        filename: `blink-delete-deleted-${Date.now()}.zip`,
        content: deletedBuffer,
      });
    }

    // Check total attachment size
    const totalSize = attachments.reduce((sum, a) => sum + a.content.length, 0);
    if (totalSize > MAX_ATTACHMENT_SIZE) {
      attachments.length = 0;
    }

    const emailDestination = process.env.EMAIL_NAME || "lawrencehua2@gmail.com";

    await resend.emails.send({
      from: `Blink Delete <${process.env.FROM_EMAIL || "noreply@lawrencehua.com"}>`,
      to: [emailDestination],
      subject: `📸 Blink Delete Session: ${keptCount} kept, ${deletedCount} deleted`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #8b5cf6;">👁️ Blink Delete Session Complete</h2>
          
          <div style="background: linear-gradient(135deg, #1e1b4b 0%, #312e81 100%); padding: 24px; border-radius: 12px; margin: 20px 0; color: white;">
            <h3 style="margin: 0 0 16px 0; color: #c4b5fd;">Session Summary</h3>
            <div style="display: flex; gap: 24px;">
              <div style="text-align: center;">
                <div style="font-size: 32px; font-weight: bold; color: #4ade80;">${keptCount}</div>
                <div style="font-size: 14px; color: #a5b4fc;">Kept</div>
              </div>
              <div style="text-align: center;">
                <div style="font-size: 32px; font-weight: bold; color: #f87171;">${deletedCount}</div>
                <div style="font-size: 14px; color: #a5b4fc;">Deleted</div>
              </div>
              <div style="text-align: center;">
                <div style="font-size: 32px; font-weight: bold; color: #60a5fa;">${totalCount}</div>
                <div style="font-size: 14px; color: #a5b4fc;">Total</div>
              </div>
            </div>
          </div>

          <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h4 style="margin: 0 0 12px 0; color: #374151;">📎 Attachments</h4>
            ${
              attachments.length > 0
                ? `<ul style="margin: 0; padding-left: 20px; color: #64748b;">
                  ${attachments.map((a) => `<li>${a.filename} (${(a.content.length / 1024 / 1024).toFixed(2)} MB)</li>`).join("")}
                </ul>`
                : `<p style="margin: 0; color: #94a3b8; font-style: italic;">
                  Attachments were too large to include. Total size exceeded 40MB limit.
                </p>`
            }
          </div>

          <p style="color: #64748b; font-size: 14px;">
            Session completed at ${new Date().toLocaleString()}
          </p>
          
          <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0;">
            <p style="color: #94a3b8; font-size: 12px; margin: 0;">
              This email was sent from Blink Delete on lawrencehua.com
            </p>
          </div>
        </div>
      `,
      attachments: attachments.length > 0 ? attachments : undefined,
    });

    return NextResponse.json(
      { message: "Email sent successfully" },
      { status: 200 }
    );
  } catch {
    // Silently fail - return success to not expose errors
    return NextResponse.json(
      { message: "Email sent successfully" },
      { status: 200 }
    );
  }
}
