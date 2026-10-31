data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  partition  = data.aws_partition.current.partition
}

data "aws_iam_policy_document" "trust" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "AWS"
      identifiers = ["arn:${local.partition}:iam::${local.account_id}:root"]
    }
  }
}

# Cross-region inference needs permission on the inference profile in the
# source region AND on the foundation model in every destination region.
data "aws_iam_policy_document" "invoke" {
  statement {
    actions = [
      "bedrock:InvokeModel",
      "bedrock:InvokeModelWithResponseStream",
    ]
    resources = concat(
      [for id in var.model_ids : "arn:${local.partition}:bedrock:*::foundation-model/${id}"],
      [for id in var.model_ids : "arn:${local.partition}:bedrock:*:${local.account_id}:inference-profile/*.${id}"],
    )
  }
}

resource "aws_iam_role" "team" {
  for_each = var.teams

  name               = "bedrock-atlas-team-${each.key}"
  assume_role_policy = data.aws_iam_policy_document.trust.json

  tags = {
    Team = each.key
  }
}

resource "aws_iam_role_policy" "invoke" {
  for_each = var.teams

  name   = "bedrock-invoke"
  role   = aws_iam_role.team[each.key].id
  policy = data.aws_iam_policy_document.invoke.json
}
