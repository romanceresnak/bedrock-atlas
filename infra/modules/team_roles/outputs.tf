output "role_arns" {
  description = "Team name => role ARN."
  value       = { for k, r in aws_iam_role.team : k => r.arn }
}
