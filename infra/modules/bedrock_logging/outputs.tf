output "bucket" {
  value = aws_s3_bucket.logs.bucket
}

output "log_group_name" {
  value = aws_cloudwatch_log_group.invocations.name
}
