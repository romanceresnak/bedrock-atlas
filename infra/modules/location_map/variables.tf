variable "region" {
  description = "Region of the API key and the map resource."
  type        = string
}

variable "allowed_referers" {
  description = "HTTP referers allowed to use the key (max 5), e.g. the CloudFront URL."
  type        = list(string)
}
