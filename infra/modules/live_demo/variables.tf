variable "region" {
  description = "Region of the API, its Lambda and the DynamoDB table."
  type        = string
}

variable "log_groups" {
  description = "Source region => Bedrock invocation log group (CloudWatch Logs)."
  type        = map(string)
}

variable "model_ids" {
  description = "Foundation model IDs the live demo may invoke."
  type        = list(string)
}

variable "daily_cap" {
  description = "Hard limit of live Bedrock calls per UTC day for the whole site."
  type        = number
}
