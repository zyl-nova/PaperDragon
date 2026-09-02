# Chain-of-Thought Prompting Elicits Reasoning in Large Language Models

摘要：本文研究如何通过 chain-of-thought prompting 让大语言模型在复杂推理任务中生成中间推理步骤，从而提升算术、常识和符号推理表现。

问题：传统提示方法只要求模型直接输出答案，在多步推理任务中容易失败。
动机：如果模型能够显式写出中间推理链，就可能更好地分解问题。
方法：作者在少样本提示中加入人工编写的推理过程示例，引导模型输出逐步推理。
理论：推理链可以被看作隐式计算过程的可观察展开。
公式：$p(y|x)=\sum_z p(y|z,x)p(z|x)$
实验：在 GSM8K、MultiArith、CommonsenseQA 等数据集上比较标准 prompting 与 chain-of-thought prompting。
结果：当模型规模足够大时，chain-of-thought prompting 显著提升复杂推理任务准确率。
贡献：提出简单有效的 prompting 范式，证明中间推理步骤能够增强大模型推理能力。
创新：不修改模型参数，仅通过提示设计激发推理能力。

图片：[Figure 1: Chain-of-thought prompting 示例流程图]
图片：[Figure 2: 不同模型规模下的准确率变化]
