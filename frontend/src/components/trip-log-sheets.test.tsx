import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tripPlanSchema } from "@/lib/contracts";
import fixture from "@/test/fixtures/trip.json";
import { TripLogSheets } from "./trip-log-sheets";

const { download } = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock("@/lib/log-export", () => ({ downloadLogs: download }));
const plan = tripPlanSchema.parse(fixture);
const multi = structuredClone(plan);
multi.logs.push({
  ...structuredClone(plan.logs[0]!),
  date: "10/04/2026",
  iso_date: "2026-10-04",
});
multi.summary.log_days = 2;
beforeEach(() => {
  download.mockReset();
  download.mockResolvedValue(undefined);
});
describe("log pager and exports", () => {
  it("selects later days and downloads the selected sheet with its original trip page number", async () => {
    render(<TripLogSheets plan={multi} disabled={false} />);
    const user = userEvent.setup();
    expect(screen.getByRole("button", { name: "Previous log day" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Next log day" }));
    expect(
      screen.getByRole("img", { name: /10\/04\/2026 - Day 2 of 2/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next log day" })).toBeDisabled();
    await user.click(
      screen.getByRole("button", { name: "Download PNG for 10/04/2026" }),
    );
    await waitFor(() => expect(download).toHaveBeenCalled());
    expect(download.mock.calls[0]![0]).toMatchObject({
      logs: [multi.logs[1]],
      format: "png",
      firstDay: 2,
      totalDays: 2,
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Downloaded 10/04/2026 as PNG.",
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Choose log day" }),
      "0",
    );
    expect(
      screen.getByRole("img", { name: /10\/03\/2026 - Day 1 of 2/ }),
    ).toBeInTheDocument();
  });
  it("downloads all days in chronological order and exposes readable exact-minute details", async () => {
    render(<TripLogSheets plan={multi} disabled={false} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Download all (2)" }));
    await waitFor(() =>
      expect(download).toHaveBeenCalledWith(
        expect.objectContaining({
          logs: multi.logs,
          format: "pdf",
          firstDay: 1,
          totalDays: 2,
        }),
      ),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Downloaded 2 sheets in one PDF.",
    );
    await user.click(screen.getByText("View log details as text"));
    expect(screen.getByText("19.00 hours")).toHaveTextContent("(19h)");
    expect(screen.getByText("08:00")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Enlarge" }));
    expect(screen.getByRole("button", { name: "Fit to width" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
  it("blocks stale downloads while keeping the sheet available for review", () => {
    render(<TripLogSheets plan={plan} disabled />);
    expect(screen.getByRole("button", { name: /Download PNG/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Download PDF/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Download all/ })).toBeDisabled();
    expect(screen.getByRole("img", { name: /Driver's Daily Log/ })).toBeInTheDocument();
  });
  it("reenables controls and offers a retry after a safe export error", async () => {
    download.mockRejectedValueOnce(new Error("Private upstream error"));
    render(<TripLogSheets plan={plan} disabled={false} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Download PDF/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn’t create the download. Try again.",
    );
    expect(screen.queryByText("Private upstream error")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Download PDF/ }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(download).toHaveBeenCalledTimes(2);
  });
  it("cancels an in-flight export on unmount", async () => {
    let finish: () => void = () => {};
    download.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { unmount } = render(<TripLogSheets plan={multi} disabled={false} />);
    await userEvent.setup().click(screen.getByRole("button", { name: /Download all/ }));
    await waitFor(() => expect(download).toHaveBeenCalled());
    const signal: AbortSignal = download.mock.calls[0]![0].signal;
    expect(screen.getByRole("button", { name: "Next log day" })).toBeDisabled();
    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => finish());
  });
});
