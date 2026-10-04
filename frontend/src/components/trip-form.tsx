import { useEffect, useRef, useState } from "react";
import { Controller, useForm, type FieldPath } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowRight,
  ArrowUpDown,
  ChevronDown,
  CircleHelp,
  Clock3,
  LoaderCircle,
  Route,
  Sparkles,
  Truck,
} from "lucide-react";
import {
  defaults,
  formSchema,
  sample,
  toTripRequest,
  type TripFormValues,
} from "@/lib/trip-form";
import type { TripRequest } from "@/lib/contracts";
import { AddressInput } from "./address-input";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

interface TripFormProps {
  pending: boolean;
  onSubmit: (request: TripRequest) => void;
  onEdit: () => void;
}

export function TripForm({ pending, onSubmit, onEdit }: TripFormProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [invalidSubmissions, setInvalidSubmissions] = useState(0);
  const [focusField, setFocusField] = useState<FieldPath<TripFormValues> | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const errorSummary = useRef<HTMLDivElement>(null);
  const focusedSubmission = useRef(0);
  const {
    control,
    register,
    watch,
    getValues,
    setValue,
    setFocus,
    reset,
    handleSubmit,
    formState: { errors },
  } = useForm<TripFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: defaults,
    mode: "onTouched",
    shouldFocusError: false,
  });
  useEffect(() => {
    if (!invalidSubmissions) focusedSubmission.current = 0;
    if (invalidSubmissions > focusedSubmission.current && errorSummary.current) {
      errorSummary.current.focus();
      focusedSubmission.current = invalidSubmissions;
    }
  }, [invalidSubmissions, errors]);
  useEffect(() => {
    if (focusField) {
      setFocus(focusField);
      setFocusField(null);
    }
  }, [focusField, setFocus]);
  const issues = (
    [
      {
        name: "current_location",
        label: "Current location",
        message: errors.current_location?.label?.message,
      },
      {
        name: "pickup_location",
        label: "Pickup location",
        message: errors.pickup_location?.label?.message,
      },
      {
        name: "dropoff_location",
        label: "Delivery location",
        message: errors.dropoff_location?.label?.message,
      },
      {
        name: "cycle_used_hours",
        label: "Cycle hours already used",
        message: errors.cycle_used_hours?.message,
      },
      {
        name: "departure",
        label: "Departure date & time",
        message: errors.departure?.message,
      },
      {
        name: "driver_name",
        label: "Driver name",
        message: errors.driver_name?.message,
      },
      {
        name: "carrier.name",
        label: "Carrier name",
        message: errors.carrier?.name?.message,
      },
      {
        name: "carrier.address",
        label: "Main office address",
        message: errors.carrier?.address?.message,
      },
      {
        name: "carrier.home_terminal_address",
        label: "Home terminal address",
        message: errors.carrier?.home_terminal_address?.message,
      },
      {
        name: "vehicle",
        label: "Truck / trailer numbers",
        message: errors.vehicle?.message,
      },
      {
        name: "shipping_doc",
        label: "Shipping document / commodity",
        message: errors.shipping_doc?.message,
      },
    ] satisfies { name: FieldPath<TripFormValues>; label: string; message?: string }[]
  ).filter((issue) => issue.message);
  const used = watch("cycle_used_hours");
  const safeUsed = Number.isFinite(used) ? Math.min(70, Math.max(0, used)) : 0;
  const remaining = Math.max(0, 70 - safeUsed);
  const onSwap = () => {
    const current = getValues("current_location");
    setValue("current_location", getValues("dropoff_location"), {
      shouldValidate: true,
    });
    setValue("dropoff_location", current, { shouldValidate: true });
    onEdit();
    setAnnouncement("Start and delivery locations swapped. Pickup is unchanged.");
  };
  const textField = (
    name: FieldPath<TripFormValues>,
    label: string,
    maxLength: number,
    error?: string,
    type = "text",
  ) => (
    <div className="detail-field">
      <label className="field-label" htmlFor={name}>
        {label}
      </label>
      <Input
        id={name}
        type={type}
        {...register(name)}
        maxLength={maxLength}
        aria-invalid={Boolean(error)}
        aria-describedby={
          [name === "departure" ? "departure-help" : "", error ? `${name}-error` : ""]
            .filter(Boolean)
            .join(" ") || undefined
        }
      />
      {error && (
        <p className="field-error" id={`${name}-error`}>
          {error}
        </p>
      )}
    </div>
  );

  return (
    <section className="planner-card" aria-labelledby="form-title">
      <div className="form-heading">
        <div>
          <span className="eyebrow">YOUR NEXT RUN</span>
          <h2 id="form-title">Plan a trip</h2>
          <p>A clear route. Every required stop.</p>
        </div>
        <span className="form-heading-icon">
          <Route size={23} />
        </span>
      </div>
      <form
        id="trip-form"
        noValidate
        onChange={onEdit}
        onSubmit={handleSubmit(
          (values) => onSubmit(toTripRequest(values)),
          (fieldErrors) => {
            if (
              fieldErrors.departure ||
              fieldErrors.driver_name ||
              fieldErrors.carrier ||
              fieldErrors.vehicle ||
              fieldErrors.shipping_doc
            )
              setDetailsOpen(true);
            setInvalidSubmissions((count) => count + 1);
          },
        )}
      >
        {invalidSubmissions > 0 && issues.length > 0 && (
          <div
            className="form-error-summary"
            role="alert"
            tabIndex={-1}
            ref={errorSummary}
            aria-labelledby="form-errors-title"
          >
            <h3 id="form-errors-title">Check your trip details</h3>
            <p>Fix these fields, then plan your trip again.</p>
            <ul>
              {issues.map(({ name, label, message }) => (
                <li key={name}>
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        ![
                          "current_location",
                          "pickup_location",
                          "dropoff_location",
                          "cycle_used_hours",
                        ].includes(name)
                      )
                        setDetailsOpen(true);
                      setFocusField(name);
                    }}
                  >
                    {label}: {message}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="sr-only" role="status" aria-atomic="true">
          {announcement}
        </p>
        <fieldset disabled={pending} className="form-fieldset">
          <div className="form-section route-section">
            <div className="section-heading">
              <h3>
                <span className="step-number">1</span> Route
              </h3>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="sample-button"
                onClick={() => {
                  reset(structuredClone(sample));
                  setInvalidSubmissions(0);
                  setAnnouncement(
                    "Sample trip loaded: Chicago to Dallas to Los Angeles, with 34 cycle hours used.",
                  );
                  onEdit();
                }}
              >
                <Sparkles size={14} />
                Use sample trip
              </Button>
            </div>
            <div className="route-fields">
              <Controller
                name="current_location"
                control={control}
                render={({ field }) => (
                  <AddressInput
                    label="Current location"
                    placeholder="Where are you starting?"
                    kind="current"
                    value={field.value}
                    onChange={(location) => {
                      field.onChange(location);
                      onEdit();
                    }}
                    onBlur={field.onBlur}
                    inputRef={field.ref}
                    error={errors.current_location?.label?.message}
                  />
                )}
              />
              <Controller
                name="pickup_location"
                control={control}
                render={({ field }) => (
                  <AddressInput
                    label="Pickup location"
                    placeholder="Where is the freight?"
                    kind="pickup"
                    value={field.value}
                    onChange={(location) => {
                      field.onChange(location);
                      onEdit();
                    }}
                    onBlur={field.onBlur}
                    inputRef={field.ref}
                    error={errors.pickup_location?.label?.message}
                  />
                )}
              />
              <Controller
                name="dropoff_location"
                control={control}
                render={({ field }) => (
                  <AddressInput
                    label="Delivery location"
                    placeholder="Where are you delivering?"
                    kind="delivery"
                    value={field.value}
                    onChange={(location) => {
                      field.onChange(location);
                      onEdit();
                    }}
                    onBlur={field.onBlur}
                    inputRef={field.ref}
                    error={errors.dropoff_location?.label?.message}
                  />
                )}
              />
            </div>
            <button type="button" className="swap-button" onClick={onSwap}>
              <ArrowUpDown size={13} />
              Swap start and delivery
            </button>
          </div>
          <div className="form-section">
            <div className="section-heading">
              <h3>
                <span className="step-number">2</span> Driver cycle
              </h3>
              <span className="quiet-tag">70 hours / 8 days</span>
            </div>
            <div className="cycle-input-row">
              <label htmlFor="cycle-hours" className="field-label">
                Cycle hours already used
              </label>
              <div className="hours-input">
                <Input
                  id="cycle-hours"
                  type="number"
                  min={0}
                  max={70}
                  step={0.25}
                  {...register("cycle_used_hours", { valueAsNumber: true })}
                  aria-invalid={Boolean(errors.cycle_used_hours)}
                  aria-required="true"
                  aria-describedby={`cycle-help${errors.cycle_used_hours ? " cycle-error" : ""}`}
                />
                <span>hrs</span>
              </div>
            </div>
            <input
              className="cycle-slider"
              type="range"
              min={0}
              max={70}
              step={0.25}
              value={safeUsed}
              aria-label="Cycle hours already used slider"
              aria-valuetext={`${Number(safeUsed.toFixed(2))} hours used, ${Number(remaining.toFixed(2))} hours available before a restart`}
              aria-describedby="cycle-help"
              style={{
                backgroundImage: `linear-gradient(to right, var(--primary) ${(safeUsed / 70) * 100}%, var(--input-border) ${(safeUsed / 70) * 100}%)`,
              }}
              onChange={(event) =>
                setValue("cycle_used_hours", Number(event.target.value), {
                  shouldValidate: true,
                  shouldTouch: true,
                })
              }
            />
            <div className="range-labels">
              <span>0 hrs</span>
              <span>70 hrs</span>
            </div>
            <p className="cycle-help" id="cycle-help">
              <Clock3 size={14} />
              <strong>{Number(remaining.toFixed(2))} hours</strong> available before a
              restart
            </p>
            {errors.cycle_used_hours && (
              <p id="cycle-error" className="field-error">
                {errors.cycle_used_hours.message}
              </p>
            )}
          </div>
          <div className="form-section details-section">
            <button
              type="button"
              className="details-toggle"
              aria-expanded={detailsOpen}
              aria-controls="trip-details"
              onClick={() => setDetailsOpen(!detailsOpen)}
            >
              <span>
                <span className="step-number" aria-hidden="true">
                  3
                </span>
                <strong>Trip details</strong>{" "}
                <span className="quiet-tag">Optional</span>
              </span>
              <ChevronDown className={detailsOpen ? "rotated" : ""} size={17} />
            </button>
            <p className="details-caption">
              Departure, driver, and carrier information
            </p>
            <div id="trip-details" hidden={!detailsOpen} className="details-fields">
              {textField(
                "departure",
                "Departure date & time",
                40,
                errors.departure?.message,
                "datetime-local",
              )}
              <p className="field-hint" id="departure-help">
                Leave blank to depart now in the start location’s time zone. A chosen
                time uses your device’s time zone.
              </p>
              {textField(
                "driver_name",
                "Driver name",
                160,
                errors.driver_name?.message,
              )}
              {textField(
                "carrier.name",
                "Carrier name",
                160,
                errors.carrier?.name?.message,
              )}
              {textField(
                "carrier.address",
                "Main office address",
                300,
                errors.carrier?.address?.message,
              )}
              {textField(
                "carrier.home_terminal_address",
                "Home terminal address",
                300,
                errors.carrier?.home_terminal_address?.message,
              )}
              {textField(
                "vehicle",
                "Truck / trailer numbers",
                160,
                errors.vehicle?.message,
              )}
              {textField(
                "shipping_doc",
                "Shipping document / commodity",
                200,
                errors.shipping_doc?.message,
              )}
            </div>
          </div>
          <div className="form-actions">
            <Button type="submit" className="plan-button">
              {pending ? (
                <>
                  <LoaderCircle className="spin" size={18} />
                  Planning your trip…
                </>
              ) : (
                <>
                  <Truck size={18} />
                  Plan trip
                  <ArrowRight size={17} />
                </>
              )}
            </Button>
            <p>Routes, breaks, and fuel stops in one plan.</p>
          </div>
        </fieldset>
      </form>
      <aside id="planning-notes" className="planning-note">
        <CircleHelp size={17} />
        <p>
          Built for a solo property-carrying driver. Uses a 55 mph average, 1-hour
          pickup and delivery, and fuel every 1,000 miles.
        </p>
      </aside>
    </section>
  );
}
