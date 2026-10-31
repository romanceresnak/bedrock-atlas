variable "monthly_limit_usd" {
  description = "Monthly cost budget for the whole account (USD)."
  type        = number
}

variable "email" {
  description = "Address for budget alerts."
  type        = string
}
