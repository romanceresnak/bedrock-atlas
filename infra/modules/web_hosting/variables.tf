variable "region" {
  description = "Region of the private site bucket."
  type        = string
}

variable "api_domain" {
  description = "Hostname of the live demo API, served under /api/* on the same domain."
  type        = string
}
