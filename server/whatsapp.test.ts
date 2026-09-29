import { describe, expect, it, vi, beforeEach } from "vitest";
import * as db from "./db";
import * as waDb from "./whatsappDb";
import {
  normalizePhoneNumber,
} from "./whatsappDb";
import {
  buildWhatsAppLink,
  buildAgreementWhatsAppMessage,
  isWhatsAppCloudConfigured,
} from "./whatsappDelivery";
import {
  handleWhatsAppWebhookVerification,
  handleWhatsAppWebhookEvent,
} from "./whatsappWebhook";
import type { Request, Response } from "express";

describe("WhatsApp Phone Normalization & Message Formatting", () => {
  it("normalizes Kenyan 07... numbers to 2547...", () => {
    expect(normalizePhoneNumber("0712345678")).toBe("254712345678");
    expect(normalizePhoneNumber("0112345678")).toBe("254112345678");
  });

  it("normalizes international formatted numbers", () => {
    expect(normalizePhoneNumber("+254 712 345 678")).toBe("254712345678");
    expect(normalizePhoneNumber("254712345678")).toBe("254712345678");
  });

  it("builds correct wa.me link with encoded message", () => {
    const link = buildWhatsAppLink("0712345678", "Hello world");
    expect(link).toBe("https://wa.me/254712345678?text=Hello%20world");
  });

  it("builds professional agreement delivery message with 45Creatives branding", () => {
    const msg = buildAgreementWhatsAppMessage({
      clientName: "Jane Doe",
      projectName: "E-Commerce Website",
      providerName: "45Creatives",
      signingUrl: "https://45crm.vercel.app/contracts/sign/sec-tok-123",
    });

    expect(msg).toContain("Hello Jane Doe,");
    expect(msg).toContain("Your website project agreement from 45Creatives is ready for review and signature.");
    expect(msg).toContain("https://45crm.vercel.app/contracts/sign/sec-tok-123");
    expect(msg).toContain("45Creatives");
  });
});

describe("WhatsApp Webhook Verification (GET)", () => {
  beforeEach(() => {
    process.env.WHATSAPP_VERIFY_TOKEN = "test_verify_token_45";
  });

  it("accepts valid verification request and responds with challenge", async () => {
    const req = {
      query: {
        "hub.mode": "subscribe",
        "hub.verify_token": "test_verify_token_45",
        "hub.challenge": "challenge_code_987",
      },
    } as unknown as Request;

    let sentStatus = 0;
    let sentBody: any = null;
    const res = {
      status: vi.fn().mockImplementation((status: number) => {
        sentStatus = status;
        return {
          send: vi.fn().mockImplementation((body: any) => {
            sentBody = body;
          }),
        };
      }),
    } as unknown as Response;

    await handleWhatsAppWebhookVerification(req, res);

    expect(sentStatus).toBe(200);
    expect(sentBody).toBe("challenge_code_987");
  });

  it("rejects verification when verify_token does not match", async () => {
    const req = {
      query: {
        "hub.mode": "subscribe",
        "hub.verify_token": "wrong_token",
        "hub.challenge": "challenge_code_987",
      },
    } as unknown as Request;

    let sentStatus = 0;
    let sentBody: any = null;
    const res = {
      status: vi.fn().mockImplementation((status: number) => {
        sentStatus = status;
        return {
          send: vi.fn().mockImplementation((body: any) => {
            sentBody = body;
          }),
        };
      }),
    } as unknown as Response;

    await handleWhatsAppWebhookVerification(req, res);

    expect(sentStatus).toBe(403);
    expect(sentBody).toBe("Forbidden");
  });

  it("rejects verification when hub.mode is not subscribe", async () => {
    const req = {
      query: {
        "hub.mode": "other",
        "hub.verify_token": "test_verify_token_45",
        "hub.challenge": "challenge_code_987",
      },
    } as unknown as Request;

    let sentStatus = 0;
    const res = {
      status: vi.fn().mockImplementation((status: number) => {
        sentStatus = status;
        return { send: vi.fn() };
      }),
    } as unknown as Response;

    await handleWhatsAppWebhookVerification(req, res);

    expect(sentStatus).toBe(403);
  });
});

describe("WhatsApp Webhook Event Handling (POST)", () => {
  it("gracefully ignores non-whatsapp webhook payloads with 200 OK", async () => {
    const req = {
      body: { object: "page" },
    } as unknown as Request;

    let sentStatus = 0;
    let sentJson: any = null;
    const res = {
      status: vi.fn().mockImplementation((status: number) => {
        sentStatus = status;
        return {
          json: vi.fn().mockImplementation((data: any) => {
            sentJson = data;
          }),
        };
      }),
    } as unknown as Response;

    await handleWhatsAppWebhookEvent(req, res);

    expect(sentStatus).toBe(200);
    expect(sentJson).toEqual({ status: "ignored" });
  });

  it("returns 200 OK when processing a valid WhatsApp status event payload", async () => {
    vi.spyOn(waDb, "updateWhatsAppMessageStatus").mockResolvedValueOnce({} as any);
    vi.spyOn(waDb, "findContractByWhatsAppMessageId").mockResolvedValueOnce(null);

    const req = {
      body: {
        object: "whatsapp_business_account",
        entry: [
          {
            id: "123456789",
            changes: [
              {
                field: "messages",
                value: {
                  messaging_product: "whatsapp",
                  statuses: [
                    {
                      id: "wamid.test12345",
                      status: "delivered",
                      timestamp: "1727620000",
                      recipient_id: "254712345678",
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    } as unknown as Request;

    let sentStatus = 0;
    let sentJson: any = null;
    const res = {
      status: vi.fn().mockImplementation((status: number) => {
        sentStatus = status;
        return {
          json: vi.fn().mockImplementation((data: any) => {
            sentJson = data;
          }),
        };
      }),
    } as unknown as Response;

    await handleWhatsAppWebhookEvent(req, res);

    expect(sentStatus).toBe(200);
    expect(sentJson).toEqual({ status: "success" });
  });

  it("handles incoming WhatsApp customer replies and saves them", async () => {
    vi.spyOn(db, "appendDashboardActivity").mockResolvedValueOnce(undefined as any);
    const mockRecord = vi.spyOn(waDb, "recordWhatsAppMessage").mockResolvedValueOnce({} as any);
    vi.spyOn(waDb, "findClientOrLeadByPhone").mockResolvedValueOnce({
      type: "client",
      client: { id: "client-uuid-1", name: "Alice", workspaceId: "ws-uuid-1" } as any,
      workspaceId: "ws-uuid-1",
    });

    const req = {
      body: {
        object: "whatsapp_business_account",
        entry: [
          {
            id: "123456789",
            changes: [
              {
                field: "messages",
                value: {
                  messaging_product: "whatsapp",
                  messages: [
                    {
                      from: "254712345678",
                      id: "wamid.msg123",
                      timestamp: "1727620000",
                      type: "text",
                      text: { body: "I am ready to sign the agreement!" },
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    } as unknown as Request;

    let sentStatus = 0;
    let sentJson: any = null;
    const res = {
      status: vi.fn().mockImplementation((status: number) => {
        sentStatus = status;
        return {
          json: vi.fn().mockImplementation((data: any) => {
            sentJson = data;
          }),
        };
      }),
    } as unknown as Response;

    await handleWhatsAppWebhookEvent(req, res);

    expect(sentStatus).toBe(200);
    expect(sentJson).toEqual({ status: "success" });
    expect(mockRecord).toHaveBeenCalledWith(
      "ws-uuid-1",
      expect.objectContaining({
        clientId: "client-uuid-1",
        direction: "inbound",
        body: "I am ready to sign the agreement!",
      })
    );
  });
});
