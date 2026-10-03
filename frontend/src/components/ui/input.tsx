// Adapted from shadcn/ui's MIT-licensed input for React 18.
import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => (
  <input ref={ref} type={type} className={cn("input", className)} {...props} />
));
Input.displayName = "Input";
export { Input };
