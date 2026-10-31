variable "teams" {
  description = "Demo team names. One IAM role is created per team."
  type        = set(string)
}

variable "model_ids" {
  description = "Foundation model IDs the team roles may invoke (directly or via inference profiles)."
  type        = list(string)
}
