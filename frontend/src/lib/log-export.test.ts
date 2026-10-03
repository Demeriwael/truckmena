import { beforeEach, describe, expect, it, vi } from "vitest";
import { tripPlanSchema } from "./contracts";
import fixture from "@/test/fixtures/trip.json";
import { downloadLogs } from "./log-export";

const mocks = vi.hoisted(() => ({
  png: vi.fn(),
  create: vi.fn(),
  addPage: vi.fn(),
  image: vi.fn(),
  properties: vi.fn(),
  output: vi.fn(),
}));
vi.mock("html-to-image", () => ({ toPng: mocks.png }));
vi.mock("jspdf", () => ({
  jsPDF: class {
    constructor(options: unknown) {
      mocks.create(options);
    }
    addPage = mocks.addPage;
    addImage = mocks.image;
    setProperties = mocks.properties;
    output = mocks.output;
  },
}));
const first = tripPlanSchema.parse(fixture).logs[0]!;
const second = {
  ...structuredClone(first),
  iso_date: "2026-10-04",
  date: "10/04/2026",
};
const click = vi.fn();
const makeUrl = vi.fn(() => "blob:download");
const revokeUrl = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  mocks.png.mockResolvedValue("data:image/png;base64,AAAA");
  mocks.output.mockReturnValue(new Blob(["PDF"], { type: "application/pdf" }));
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    click(this.download, this.href);
  });
  vi.stubGlobal(
    "URL",
    Object.assign(URL, { createObjectURL: makeUrl, revokeObjectURL: revokeUrl }),
  );
});
const options = () => ({
  logs: [first, second],
  warnings: [],
  format: "pdf" as const,
  signal: new AbortController().signal,
  onProgress: vi.fn(),
  firstDay: 1,
  totalDays: 2,
});
describe("fixed-size browser exports", () => {
  it("captures every day in order, keeps original day labels, and saves only the complete PDF", async () => {
    const dates: string[] = [];
    mocks.png.mockImplementation(async (node: HTMLElement) => {
      dates.push(node.querySelector("title")!.textContent!);
      expect(node.textContent).toContain("Truck 101 / Trailer 201");
      expect(node.isConnected).toBe(true);
      expect(node.getAttribute("aria-hidden")).toBe("true");
      return "data:image/png;base64,AAAA";
    });
    const args = options();
    await downloadLogs(args);
    expect(dates).toEqual([
      "Driver's Daily Log - 10/03/2026 - Day 1 of 2",
      "Driver's Daily Log - 10/04/2026 - Day 2 of 2",
    ]);
    expect(mocks.png).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({
        width: 1200,
        pixelRatio: 2,
        skipFonts: true,
        backgroundColor: "#ffffff",
      }),
    );
    expect(mocks.image).toHaveBeenCalledTimes(2);
    expect(mocks.addPage).toHaveBeenCalledTimes(1);
    expect(args.onProgress.mock.calls).toEqual([
      [1, 2],
      [2, 2],
    ]);
    expect(click).toHaveBeenCalledWith(
      "wayline-logs-2026-10-03-to-2026-10-04.pdf",
      "blob:download",
    );
    expect(document.querySelector("[inert]")).toBeNull();
  });
  it("retains the selected trip day in a single PNG", async () => {
    let title = "";
    mocks.png.mockImplementation(async (node: HTMLElement) => {
      title = node.querySelector("title")!.textContent!;
      return "data:image/png;base64,AAAA";
    });
    await downloadLogs({ ...options(), logs: [second], format: "png", firstDay: 2 });
    expect(title).toContain("Day 2 of 2");
    expect(click).toHaveBeenCalledWith(
      "wayline-log-2026-10-04.png",
      "data:image/png;base64,AAAA",
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("does not save a partial file if any later sheet fails, and removes temporary DOM", async () => {
    mocks.png
      .mockResolvedValueOnce("data:image/png;base64,AAAA")
      .mockRejectedValueOnce(new Error("Failed canvas"));
    await expect(downloadLogs(options())).rejects.toThrow("Failed canvas");
    expect(click).not.toHaveBeenCalled();
    expect(document.querySelector("[inert]")).toBeNull();
  });
  it("cancels after rendering without saving or processing more days", async () => {
    const abort = new AbortController();
    mocks.png.mockImplementation(async () => {
      abort.abort();
      return "data:image/png;base64,AAAA";
    });
    await expect(
      downloadLogs({ ...options(), signal: abort.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.png).toHaveBeenCalledTimes(1);
    expect(click).not.toHaveBeenCalled();
    expect(document.querySelector("[inert]")).toBeNull();
  });
  it("extends the PDF page for long notes rather than shrinking or clipping the image", async () => {
    const long = structuredClone(first);
    long.remarks = Array.from({ length: 20 }, (_, index) => ({
      minute_of_day: index * 60,
      place: "Long place ".repeat(20),
      note: "Full event detail ".repeat(20),
    }));
    await downloadLogs({ ...options(), logs: [long] });
    const page = mocks.create.mock.calls[0]![0] as { format: [number, number] };
    expect(page.format[0]).toBe(792);
    expect(page.format[1]).toBeGreaterThan(612);
    expect(mocks.image.mock.calls[0]![4]).toBe(752);
    expect(mocks.image.mock.calls[0]![5]).toBeCloseTo(page.format[1] - 40);
  });
});
