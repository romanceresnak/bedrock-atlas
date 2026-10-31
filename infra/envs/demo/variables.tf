variable "source_regions" {
  description = "Regions from which Bedrock is called. Invocation logging is enabled in each."
  type        = set(string)
  default     = ["eu-central-1", "us-east-1"]
}

variable "teams" {
  type    = set(string)
  default = ["research", "support", "marketing"]
}

variable "model_ids" {
  type = list(string)
  default = [
    "anthropic.claude-haiku-4-5-20251001-v1:0",
    "amazon.nova-lite-v1:0",
  ]
}
